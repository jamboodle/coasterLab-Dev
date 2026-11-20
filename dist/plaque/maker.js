import {createViewer} from './viewer.js';
import {downloadFile, plaqueSTLs, preparePlaqueUpload} from './export.js';
import {bambuPlacement} from '../shared/plaque-layout.js';

const $ = id => document.getElementById(id);
const traceControls = ['mode', 'color-count', 'detail', 'background', 'smooth-outer', 'edge-strength', 'clean-specks', 'seal-rim', 'threshold', 'pinhole'];
const controls = ['file', 'sample', ...traceControls, 'trace-artwork', 'width', 'largest', 'clean-relief', 'build', 'project', 'stls'];
let assets;
async function getAssets() {
  if (assets) return assets;
  const response = await fetch('../asset-manifest.json');
  if (!response.ok) throw Error('CoasterPrint’s trace engine could not be loaded.');
  assets = await response.json();
  return assets;
}
let svgURL, imageLoaded = false, trace, model, busy = false, viewer, draggedTier;

function refresh() {
  for (const id of controls) $(id).disabled = busy;
  const rows = [...$('tiers').children];
  for (const [index, row] of rows.entries()) {
    for (const input of row.querySelectorAll('input')) input.disabled = busy;
    row.querySelector('.tier-grip').draggable = !busy;
    row.querySelector('[data-move="-1"]').disabled = busy || index === 0;
    row.querySelector('[data-move="1"]').disabled = busy || index === rows.length - 1;
  }
  const monochrome = $('mode').value === 'bw';
  $('color-settings').hidden = monochrome;
  $('mono-settings').hidden = !monochrome;
  $('clean-specks').disabled ||= monochrome;
  $('seal-rim').disabled ||= monochrome;
  $('edge-strength').disabled ||= !$('smooth-outer').checked;
  $('trace-artwork').disabled ||= !imageLoaded;
  $('build').disabled ||= !trace;
  $('project').disabled ||= !model;
  $('stls').disabled ||= !model;
}

function runWorker(url, options, payload, transfer = []) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(url, options);
    const timer = setTimeout(() => finish(reject, Error('Processing took too long. Try fewer colors or Smooth detail.')), 120000);
    function finish(callback, value) {
      clearTimeout(timer);
      worker.terminate();
      callback(value);
    }
    worker.onmessage = ({data}) => data.error ? finish(reject, Error(data.error)) : finish(resolve, data);
    worker.onerror = () => finish(reject, Error('The geometry or tracing engine could not start.'));
    worker.onmessageerror = () => finish(reject, Error('The browser could not read the processing result.'));
    try { worker.postMessage(payload, transfer); } catch (error) { finish(reject, error); }
  });
}

function toggleViewer(visible) {
  for (const id of ['viewer', 'viewer-controls', 'viewer-help']) $(id).hidden = !visible;
  $('model').hidden = visible;
  $('viewer-fallback').hidden = visible || !model;
}

function invalidateModel() {
  model = null;
  viewer?.clear();
  toggleViewer(false);
  const canvas = $('model');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  $('model-status').textContent = trace ? 'Build the plaque to preview the current heights.' :
    'Trace your artwork, set the heights, then build the plaque.';
  $('export-status').textContent = '';
  refresh();
}

function invalidateTrace() {
  if (svgURL) URL.revokeObjectURL(svgURL);
  svgURL = undefined;
  trace = null;
  $('traced').replaceChildren();
  clearTierDrag();
  $('tiers').replaceChildren();
  $('tier-status').textContent = '';
  invalidateModel();
}

function showSource(image, name) {
  invalidateTrace();
  const canvas = $('original');
  const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  imageLoaded = true;
  $('artwork-previews').hidden = false;
  $('trace-status').textContent = name;
  refresh();
}

function sampleImage() {
  const canvas = document.createElement('canvas');
  canvas.width = 520;
  canvas.height = 500;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3b794e';
  ctx.beginPath();
  ctx.moveTo(260, 450);
  ctx.bezierCurveTo(205, 405, 40, 293, 40, 158);
  ctx.bezierCurveTo(40, 46, 176, 28, 260, 128);
  ctx.bezierCurveTo(344, 28, 480, 46, 480, 158);
  ctx.bezierCurveTo(480, 293, 315, 405, 260, 450);
  ctx.fill();
  ctx.fillStyle = '#f582a5';
  for (let i = 0; i < 5; i++) {
    const angle = Math.PI * 2 * i / 5;
    ctx.beginPath();
    ctx.arc(260 + Math.cos(angle) * 57, 242 + Math.sin(angle) * 57, 43, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.fillStyle = '#fff4d9';
  ctx.beginPath();
  ctx.arc(260, 242, 31, 0, 2 * Math.PI);
  ctx.fill();
  return canvas;
}

function hexColor(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value);
  if (!rgb) throw Error('The trace returned an unsupported color.');
  return '#' + rgb.slice(1).map(channel => Number(channel).toString(16).padStart(2, '0')).join('');
}

function borderColor(sourceColors) {
  if ($('background').checked) return null;
  const canvas = $('original'), ctx = canvas.getContext('2d');
  const points = [[0, 0], [canvas.width - 1, 0], [0, canvas.height - 1], [canvas.width - 1, canvas.height - 1]];
  const pixels = points.map(([x, y]) => ctx.getImageData(x, y, 1, 1).data);
  const corner = pixels.find(pixel => pixel[3] >= 245 && pixels.filter(other => other[3] >= 245 &&
    [0, 1, 2].every(channel => Math.abs(pixel[channel] - other[channel]) < 24)).length >= 3);
  if (!corner) return null;
  let best, distance = Infinity;
  for (const color of sourceColors) {
    const next = [0, 1, 2].reduce((total, channel) => total +
      (parseInt(color.slice(1 + 2 * channel, 3 + 2 * channel), 16) - corner[channel]) ** 2, 0);
    if (next < distance) {
      best = color;
      distance = next;
    }
  }
  return best;
}

function readTrace(result, width) {
  const document = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
  const paths = [...document.querySelectorAll('path[fill][d]')].filter(path => !path.closest('defs')).map(path => ({
    color: hexColor(path.getAttribute('fill')), d: path.getAttribute('d'), fillRule: path.getAttribute('fill-rule')
  }));
  if (!paths.length) throw Error('No printable colors were detected.');
  const perimeter = result.perimeterPathID && document.getElementById(result.perimeterPathID)?.getAttribute('d');
  const rimColor = result.perimeterFill && hexColor(result.perimeterFill);
  const sourceColors = [...new Set(paths.map(path => path.color))];
  const dominant = borderColor(sourceColors) || rimColor;
  if (sourceColors.includes(dominant)) {
    sourceColors.splice(sourceColors.indexOf(dominant), 1);
    sourceColors.unshift(dominant);
  }
  const perimeterMask = result.perimeterMaskPathID && document.getElementById(result.perimeterMaskPathID)?.getAttribute('d');
  return {paths, perimeter, perimeterMask, rimColor, rimWidth: result.perimeterRimPx, rimSeal: result.rimSealPx,
    removedEdges: result.edgeCleanup?.removedRegionsD, viewWidth: width, sourceColors};
}

const heightInput = row => row.querySelector('[data-field=top]');
const heightError = 'Use distinct top heights at least 0.2 mm apart, from 0.2 to 50 mm.';

function orderedHeights(rows) {
  const heights = rows.map(row => heightInput(row).valueAsNumber).sort((a, b) => b - a);
  return heights.every((height, index) => Number.isFinite(height) && height <= 50 &&
    height - (heights[index + 1] ?? 0) >= 0.2 - 1e-6) ? heights : null;
}

function describeTierOrder() {
  const list = $('tiers');
  for (const [index, row] of [...list.children].entries()) {
    row.querySelector('.tier-position').textContent = index === list.children.length - 1 ? 'Base' :
      index === 0 ? 'Top' : String(index + 1);
  }
}

function moveTier(row, destination, keyboardDirection) {
  if (busy || row === destination) return;
  const list = $('tiers'), rows = [...list.children];
  const from = rows.indexOf(row), to = rows.indexOf(destination);
  if (from < 0 || to < 0) return;
  const heights = orderedHeights(rows);
  if (!heights) {
    $('tier-status').textContent = 'Fix the heights before reordering. ' + heightError;
    return;
  }
  list.insertBefore(row, from < to ? destination.nextSibling : destination);
  for (const [index, tier] of [...list.children].entries()) heightInput(tier).value = heights[index];
  describeTierOrder();
  invalidateModel();
  $('tier-status').textContent = `${row.dataset.source.toUpperCase()} moved to ${heights[to]} mm. Heights updated.`;
  if (keyboardDirection) {
    const button = row.querySelector(`[data-move="${keyboardDirection}"]`);
    (button.disabled ? row.querySelector(`[data-move="${-keyboardDirection}"]`) : button).focus();
  }
}

function clearTierDrag() {
  draggedTier = undefined;
  for (const row of $('tiers').children) row.classList.remove('dragging', 'drop-before', 'drop-after');
}

function renderTiers(sourceColors) {
  const rows = sourceColors.map((source, index) => {
    const row = document.createElement('div');
    row.className = 'tier';
    row.dataset.source = source;
    row.setAttribute('role', 'listitem');
    const heading = document.createElement('div');
    heading.className = 'tier-heading';
    const grip = document.createElement('span');
    grip.className = 'tier-grip';
    grip.textContent = '⠿';
    grip.title = 'Drag to reorder';
    grip.setAttribute('aria-hidden', 'true');
    const original = document.createElement('span');
    original.className = 'source-color';
    const swatch = document.createElement('span');
    swatch.style.backgroundColor = source;
    const position = document.createElement('small');
    position.className = 'tier-position';
    original.append(swatch, source.toUpperCase(), position);
    heading.append(grip, original);

    grip.ondragstart = event => {
      if (busy) return event.preventDefault();
      draggedTier = row;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', source);
      row.classList.add('dragging');
    };
    grip.ondragend = clearTierDrag;
    row.ondragover = event => {
      if (!draggedTier || draggedTier === row || busy) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      row.classList.toggle('drop-before', Boolean(row.compareDocumentPosition(draggedTier) & Node.DOCUMENT_POSITION_FOLLOWING));
      row.classList.toggle('drop-after', !row.classList.contains('drop-before'));
    };
    row.ondragleave = event => {
      if (!row.contains(event.relatedTarget)) row.classList.remove('drop-before', 'drop-after');
    };
    row.ondrop = event => {
      if (!draggedTier || busy) return;
      event.preventDefault();
      moveTier(draggedTier, row);
      clearTierDrag();
    };

    function field(text, name, properties) {
      const label = document.createElement('label');
      const input = Object.assign(document.createElement('input'), properties);
      input.dataset.field = name;
      input.setAttribute('aria-label', text + ' for ' + source);
      input.oninput = invalidateModel;
      label.append(text, input);
      return label;
    }

    const arrows = document.createElement('div');
    arrows.className = 'tier-arrows';
    for (const direction of [-1, 1]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.move = direction;
      button.textContent = direction < 0 ? '↑' : '↓';
      button.setAttribute('aria-label', 'Move ' + source + (direction < 0 ? ' higher' : ' lower'));
      button.onclick = () => moveTier(row, direction < 0 ? row.previousElementSibling : row.nextElementSibling, direction);
      arrows.append(button);
    }

    const height = field('Top height (mm)', 'top', {type: 'number', value: (index + 1) * 2, min: 0.2, max: 50, step: 0.1});
    const topInput = height.querySelector('input');
    topInput.oninput = () => {
      $('tier-status').textContent = orderedHeights([...$('tiers').children]) ? '' : heightError;
      invalidateModel();
    };
    topInput.onchange = () => {
      const all = [...$('tiers').children];
      if (!orderedHeights(all)) return;
      const sorted = [...all].sort((a, b) => heightInput(b).valueAsNumber - heightInput(a).valueAsNumber);
      if (sorted.some((tier, index) => tier !== all[index])) $('tiers').append(...sorted);
      $('tier-status').textContent = '';
      describeTierOrder();
      refresh();
    };
    row.append(heading, height, field('Print color', 'color', {type: 'color', value: source}), arrows);
    return row;
  });
  $('tiers').replaceChildren(...rows.reverse());
  describeTierOrder();
}

async function traceSource() {
  if (busy || !imageLoaded) return;
  const count = $('color-count').valueAsNumber;
  if ($('mode').value === 'color' && (!Number.isInteger(count) || count < 2 || count > 12)) {
    $('trace-status').textContent = 'Enter a maximum of 2 to 12 colors.';
    return;
  }
  invalidateTrace();
  busy = true;
  refresh();
  $('trace-status').textContent = 'Tracing solid colors…';
  try {
    const {scripts} = await getAssets();
    const canvas = $('original');
    const {width, height} = canvas;
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    const output = await runWorker('/' + scripts['worker.js'], {type: 'classic'}, {
      id: 'plaque', mode: $('mode').value, colors: count, width, height, pixels,
      detail: $('detail').value, removeBackground: $('background').checked,
      smoothOuter: $('smooth-outer').checked, edgeStrength: $('edge-strength').value,
      cleanEdgeSpecks: $('clean-specks').checked, sealOuterRim: $('seal-rim').checked,
      threshold: $('threshold').valueAsNumber, pinholeArea: Number($('pinhole').value)
    }, [pixels.buffer]);
    trace = readTrace(output, width);
    renderTiers(trace.sourceColors);
    svgURL = URL.createObjectURL(new Blob([output.svg], {type: 'image/svg+xml'}));
    const image = new Image();
    image.src = svgURL;
    image.alt = 'Artwork traced into solid colors';
    $('traced').replaceChildren(image);
    $('trace-status').textContent = `${trace.sourceColors.length} solid colors. Set the top height for each color below.`;
    invalidateModel();
  } catch (error) {
    $('trace-status').textContent = error.message;
  } finally {
    busy = false;
    refresh();
  }
}

function heightSettings() {
  const width = $('width').valueAsNumber;
  if (!Number.isFinite(width) || width < 25 || width > 250) throw Error('Enter a finished width between 25 and 250 mm.');
  const rows = [...$('tiers').children];
  if (!orderedHeights(rows)) throw Error(heightError);
  const tiers = rows.map(row => ({
    source: row.dataset.source,
    top: row.querySelector('[data-field=top]').valueAsNumber,
    color: row.querySelector('[data-field=color]').value
  }));
  return {width, tiers, largest: $('largest').checked, cleanRelief: $('clean-relief').checked};
}

function paintModel(result) {
  const canvas = $('model'), context = canvas.getContext('2d');
  const project = ([x, y], z) => [x + 0.37 * y, y * -0.62 + x * 0.22 - z * 1.7];
  const corners = [[0, 0], [result.width, 0], [0, result.height], [result.width, result.height]];
  const bounds = corners.flatMap(point => [project(point, 0), project(point, result.depth)]);
  const min = [0, 1].map(axis => Math.min(...bounds.map(point => point[axis])));
  const max = [0, 1].map(axis => Math.max(...bounds.map(point => point[axis])));
  const scale = Math.min((canvas.width - 35) / (max[0] - min[0]), (canvas.height - 35) / (max[1] - min[1]));
  const map = (p, z) => project(p, z).map((coordinate, axis) =>
    (coordinate - (max[axis] + min[axis]) / 2) * scale + (axis ? canvas.height : canvas.width) / 2);
  context.clearRect(0, 0, canvas.width, canvas.height);
  function path(points) {
    context.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) context.lineTo(...points[i]);
    context.closePath();
  }
  for (const tier of result.parts) {
    context.fillStyle = tier.color;
    context.globalAlpha = 0.7;
    context.beginPath();
    for (const polygon of tier.polygons) {
      for (const [i, a] of polygon.entries()) {
        const b = polygon[(i + 1) % polygon.length];
        const first = map(a, tier.top), last = map(b, tier.top);
        if (last[0] <= first[0]) continue;
        path([first, last, map(b, tier.bottom), map(a, tier.bottom)]);
      }
    }
    context.fill();
    context.globalAlpha = 1;
    context.beginPath();
    for (const polygon of tier.polygons) path(polygon.map(p => map(p, tier.top)));
    context.fill('evenodd');
  }
}

function showModel(result) {
  try {
    viewer ??= createViewer($('viewer'), () => {
      toggleViewer(false);
      if (model) paintModel(model);
    });
    if (viewer?.show(result)) {
      toggleViewer(true);
      return;
    }
  } catch {
    // The downloadable model and static view are usable on browsers without WebGL.
  }
  toggleViewer(false);
  paintModel(result);
}

$('zoom-in').onclick = () => viewer?.zoomBy(1.2);
$('zoom-out').onclick = () => viewer?.zoomBy(1 / 1.2);
$('view-reset').onclick = () => viewer?.reset();

async function build() {
  if (busy || !trace) return;
  invalidateModel();
  busy = true;
  refresh();
  $('model-status').textContent = 'Building stacked tiers…';
  try {
    const settings = heightSettings();
    const {scripts} = await getAssets();
    const {result} = await runWorker(new URL('./geometry-worker.js', import.meta.url), {type: 'module'}, {
      ...trace, ...settings, geometryScript: scripts['stl-geometry.js']
    });
    model = result;
    showModel(result);
    const dims = [result.width, result.height, result.depth].map(value => Number(value.toFixed(2))).join(' × ');
    $('model-status').textContent = [
      `${result.parts.length} watertight tiers · ${dims} mm`,
      result.cleaned ? 'Smoothed relief edges and cleaned small stray details.' : '',
      result.filtered ? `${result.filtered} detached raised detail(s) removed.` : '',
      result.repair ? `Used a ${result.repair} mm contour cleanup to make the mesh watertight.` : '',
      result.trimmed ? `${result.trimmed} detached outline(s) removed.` : '',
      result.omitted ? `${result.omitted} color(s) had no printable area after tracing and cleanup.` : '',
      bambuPlacement(result).checkExclusion ? 'Check clearance around the P1S front-left exclusion in the slicer, or reduce the width.' : ''
    ].filter(Boolean).join(' ');
  } catch (error) {
    $('model-status').textContent = error.message;
  } finally {
    busy = false;
    refresh();
  }
}

async function exportSTL() {
  if (!model || busy) return;
  busy = true;
  refresh();
  $('export-status').textContent = 'Preparing download…';
  try {
    downloadFile('coasterprint-plaque-stls.zip', await plaqueSTLs(model), 'application/zip');
    $('export-status').textContent = 'Download ready.';
  } catch (error) {
    $('export-status').textContent = error.message;
  } finally {
    busy = false;
    refresh();
  }
}

async function loadFile(file) {
  if (!file || busy) return;
  busy = true;
  refresh();
  try {
    if (!/\.(png|jpe?g)$/i.test(file.name) || file.size > 20 * 1024 * 1024) throw Error('Choose a PNG or JPG up to 20 MB.');
    const image = await createImageBitmap(file);
    try {
      if (image.width * image.height > 80_000_000) throw Error('This image is too large. Resize it before uploading.');
      showSource(image, file.name);
    } finally { image.close(); }
  } catch (error) {
    $('trace-status').textContent = error.message;
    return;
  } finally {
    busy = false;
    $('file').value = '';
    refresh();
  }
  await traceSource();
}
$('file').onchange = event => void loadFile(event.target.files[0]);
const drop = $('drop');
drop.ondragover = event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
  drop.classList.toggle('over', !busy);
};
drop.ondragleave = event => {
  if (!drop.contains(event.relatedTarget)) drop.classList.remove('over');
};
drop.ondrop = event => {
  event.preventDefault();
  drop.classList.remove('over');
  void loadFile(event.dataTransfer.files[0]);
};
$('sample').onclick = () => {
  $('color-count').value = 3;
  $('mode').value = 'color';
  showSource(sampleImage(), 'Flower plaque sample');
  void traceSource();
};
for (const id of traceControls) $(id).onchange = invalidateTrace;
$('threshold').oninput = () => {
  $('threshold-value').textContent = $('threshold').value;
  invalidateTrace();
};
for (const id of ['width', 'largest', 'clean-relief']) $(id).oninput = invalidateModel;
$('trace-artwork').onclick = () => void traceSource();
$('build').onclick = () => void build();
$('project').onclick = async () => {
  if (!model || busy) return;
  const selected = model;
  const onError = error => { $('export-status').textContent = error.message; };
  try {
    const {scripts} = await getAssets();
    await import('/' + scripts['export-credit-trial.js']);
    if (model !== selected || busy) return;
    await window.creditTrialDownload(() => preparePlaqueUpload(selected), {
      kind: 'plaque',
      freeSTL: exportSTL,
      onError
    });
  } catch (error) { onError(error); }
};
$('stls').onclick = () => void exportSTL();
