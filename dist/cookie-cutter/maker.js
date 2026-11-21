import {decodeArtwork} from '../suncatcher/trace.js';
import {createViewer} from '../plaque/viewer.js';
import {downloadFile} from '../plaque/export.js';
import {project3MF} from '../suncatcher/downloads.js';
import {detectOutlines, detectStamp, starSample, usesTransparency} from './trace.js';

const $ = id => document.getElementById(id);
const overlay = $('overlay');
const source = $('artwork');
const namespace = 'http://www.w3.org/2000/svg';
let assets, pathContours, image, transparent, traces = [], manual, draft, history = [], dragging;
let sizingAxis = 'width', worker, model, viewer, viewerAvailable = true, diagnostics, invalid = false, loadVersion = 0;
let timer, loading = false, previewPart = 'cutter';

async function geometryAssets() {
  if (assets) return assets;
  const response = await fetch('/asset-manifest.json');
  if (!response.ok) throw Error('The tracing and geometry tools could not be loaded. Reload to retry.');
  const {scripts} = await response.json();
  return scripts;
}

function activeOutline() {
  return manual || traces[Number($('shape').value)];
}

function addPath(points, type, closed = true) {
  if (!points?.length) return;
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', 'M' + points.map(pair => pair.join(',')).join(' L') + (closed ? ' Z' : ''));
  path.setAttribute('class', type);
  overlay.append(path);
}

function renderOutline(focus) {
  overlay.replaceChildren();
  if (previewPart === 'stamp' && model?.stamp) {
    const marks = document.createElementNS(namespace, 'path');
    marks.setAttribute('class', 'stamp-mark');
    marks.setAttribute('d', model.stamp.preview.map(points =>
      'M' + points.map(pair => pair.join(',')).join(' L') + ' Z').join(' '));
    overlay.append(marks);
  }
  overlay.dataset.mode = draft ? (draft.closed ? 'edit' : 'draw') : 'trace';
  for (const polygon of diagnostics?.issues || []) addPath(polygon, 'issue');
  addPath(draft?.points || activeOutline(), 'outline' + (invalid ? ' invalid' : ''), !draft || draft.closed);
  for (const segment of diagnostics?.segments || []) addPath(segment, 'outline invalid', false);
  if (draft) {
    const radius = Math.max(source.width, source.height) / 100;
    draft.points.forEach(([x, y], index) => {
      const handle = document.createElementNS(namespace, 'circle');
      handle.setAttribute('cx', x);
      handle.setAttribute('cy', y);
      handle.setAttribute('r', radius);
      handle.setAttribute('class', 'point');
      handle.setAttribute('tabindex', '0');
      handle.setAttribute('aria-label', 'Outline point ' + (index + 1));
      handle.dataset.point = index;
      overlay.append(handle);
    });
    if (focus !== undefined) overlay.querySelector('[data-point="' + focus + '"]')?.focus();
  }
  $('edit').disabled = !activeOutline() || activeOutline().length > 2500 || Boolean(draft);
  $('draw').disabled = !image;
  $('close').hidden = !draft;
  $('close').disabled = (draft?.points.length ?? 0) < 3;
  $('close').textContent = draft?.closed ? 'Use edited outline' : 'Close outline';
  $('undo').hidden = !draft;
  $('undo').disabled = !history.length;
  $('use-trace').hidden = !draft && !manual;
  $('use-trace').textContent = traces.length ? 'Use detected outline' : 'Cancel drawing';
  $('build').disabled = loading || Boolean(draft) || !activeOutline() || Boolean(worker);
}

function invalidate() {
  if (worker) worker.terminate();
  worker = undefined;
  clearTimeout(timer);
  model = diagnostics = undefined;
  invalid = false;
  viewer?.clear();
  $('viewer').hidden = $('viewer-controls').hidden = true;
  $('download').disabled = $('download-stamp').disabled = $('download-handle').disabled = true;
  $('preview-parts').hidden = true;
  $('stamp-status').textContent = '';
  $('download-status').textContent = '';
  previewPart = 'cutter';
  $('model-status').textContent = 'Confirm an outline to build the cutter.';
}

function syncSize() {
  const outline = activeOutline();
  const other = sizingAxis === 'width' ? 'height' : 'width';
  if (!outline) {
    $(other).value = '';
    return;
  }
  const spans = [0, 1].map(axis => {
    const values = outline.map(point => point[axis]);
    return Math.max(...values) - Math.min(...values);
  });
  const ratio = spans[1] / spans[0];
  const size = $(sizingAxis).valueAsNumber * (sizingAxis === 'width' ? ratio : 1 / ratio);
  $(other).value = Number.isFinite(size) ? Math.round(size * 10) / 10 : '';
}

function refreshTrace(reset = false) {
  if (!image) return;
  const previous = Number($('shape').value);
  invalidate();
  let traceProblem = '';
  try {
    traces = detectOutlines(image, transparent, $('threshold').valueAsNumber, $('invert').checked,
      Number($('smoothing').value), pathContours);
  } catch {
    traces = [];
    traceProblem = 'The trace could not be processed. Try more smoothing or draw an outline.';
  }
  $('shape').replaceChildren(...traces.map((_, index) =>
    new Option(index ? 'Shape ' + (index + 1) : 'Shape 1 (largest)', index)));
  $('shape').disabled = !traces.length;
  if (!reset && traces[previous]) $('shape').value = previous;
  $('trace-status').textContent = traces.length
    ? `${traces.length} detected ${traces.length === 1 ? 'shape' : 'shapes'} · ${transparent ? 'Using image transparency' : 'Using brightness threshold'}.`
    : traceProblem || 'No silhouette detected. Adjust tracing or draw an outline.';
  if (draft || manual) $('trace-status').textContent += ' Your custom outline is retained.';
  syncSize();
  renderOutline();
}

async function load(file) {
  const version = ++loadVersion;
  loading = true;
  $('trace-status').textContent = 'Loading artwork…';
  invalidate();
  renderOutline();
  try {
    if (file && !/\.(png|jpe?g)$/i.test(file.name)) throw Error('Choose a PNG or JPG image.');
    const artwork = file ? await decodeArtwork(file) : starSample();
    try {
      assets = await geometryAssets();
      ({pathContours} = await import('/' + assets['stl-geometry.js']));
      if (version !== loadVersion) return;
      const scale = Math.min(1, 600 / Math.max(artwork.width, artwork.height));
      source.width = Math.max(1, Math.round(artwork.width * scale));
      source.height = Math.max(1, Math.round(artwork.height * scale));
      const ctx = source.getContext('2d');
      ctx.drawImage(artwork, 0, 0, source.width, source.height);
      image = ctx.getImageData(0, 0, source.width, source.height);
    } finally {
      artwork.close?.();
    }
    transparent = usesTransparency(image);
    $('threshold-control').hidden = $('invert-control').hidden = transparent;
    $('threshold').value = 128;
    $('invert').checked = false;
    manual = draft = dragging = undefined;
    history = [];
    overlay.setAttribute('viewBox', `0 0 ${source.width} ${source.height}`);
    $('outline-tools').hidden = false;
    refreshTrace(true);
  } catch (error) {
    if (version === loadVersion) $('trace-status').textContent = error.message;
  } finally {
    if (version === loadVersion) {
      loading = false;
      $('file').value = '';
      renderOutline();
    }
  }
}

function changeDraft(points, closed) {
  invalidate();
  draft = {points, closed};
  history = [];
  $('trace-status').textContent = closed
    ? 'Drag points to reshape. Click near an edge to insert a point. Delete removes the focused point.'
    : 'Click around the outline to place points, then choose Close outline.';
  renderOutline();
}

function snapshot() {
  history.push(draft.points.map(point => [...point]));
}

function location(event) {
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(overlay.getScreenCTM().inverse());
  return [Math.max(0, Math.min(source.width, p.x)), Math.max(0, Math.min(source.height, p.y))];
}

function nearestEdge(point, points) {
  let index = -1, distance = Math.max(source.width, source.height) * 0.045;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i], [bx, by] = points[(i + 1) % points.length];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / (dx ** 2 + dy ** 2 || 1)));
    const gap = Math.hypot(point[0] - ax - t * dx, point[1] - ay - t * dy);
    if (gap < distance) {
      distance = gap;
      index = i;
    }
  }
  return index;
}

overlay.onpointerdown = event => {
  if (!draft || dragging || event.button !== 0) return;
  const index = event.target.dataset.point;
  if (index !== undefined) {
    snapshot();
    dragging = {index: Number(index), pointer: event.pointerId};
    overlay.setPointerCapture(event.pointerId);
    return;
  }
  if (draft.points.length >= 2500) return;
  const point = location(event);
  const edge = draft.closed ? nearestEdge(point, draft.points) : draft.points.length - 1;
  if (draft.closed && edge < 0) return;
  snapshot();
  draft.points.splice(edge + 1, 0, point);
  renderOutline();
};
overlay.onpointermove = event => {
  if (!draft || dragging?.pointer !== event.pointerId) return;
  draft.points[dragging.index] = location(event);
  renderOutline();
};
overlay.onlostpointercapture = () => { dragging = undefined; };
overlay.onkeydown = event => {
  const index = Number(event.target.dataset.point);
  if (!draft || !Number.isInteger(index)) return;
  const steps = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
  if (Object.hasOwn(steps, event.key)) {
    event.preventDefault();
    snapshot();
    draft.points[index] = draft.points[index].map((value, axis) =>
      Math.max(0, Math.min(axis ? source.height : source.width, value + steps[event.key][axis])));
    renderOutline(index);
  } else if (event.key === 'Delete' && (!draft.closed || draft.points.length > 3)) {
    event.preventDefault();
    snapshot();
    draft.points.splice(index, 1);
    renderOutline(Math.min(index, draft.points.length - 1));
  }
};

function showPart(part) {
  previewPart = part;
  const selected = {cutter: model, stamp: model.stamp, handle: model.stamp?.handle}[part];
  for (const id of ['cutter', 'stamp', 'handle']) $('view-' + id).setAttribute('aria-pressed', String(part === id));
  $('viewer').setAttribute('aria-label', 'Rotatable ' + part + ' preview');
  $('viewer').hidden = $('viewer-controls').hidden = !viewer?.show({...selected,
    parts: [{buffer: selected.buffer, color: part === 'stamp' ? '#6baad5' : '#ca537d'}]});
  renderOutline();
}

function present(result) {
  if (!result.buffer) {
    invalid = Boolean(result.segments);
    diagnostics = result;
    $('model-status').textContent = result.error + (result.segments ? '' : ' Check the outline and cutter settings.');
    return;
  }
  model = diagnostics = result;
  if (!viewer && viewerAvailable) {
    try { viewer = createViewer($('viewer'), event => {
      event.preventDefault();
      $('viewer').hidden = $('viewer-controls').hidden = true;
      $('model-status').textContent += ' 3D preview unavailable on this device.';
    }); } catch { /* The validated STL remains downloadable. */ }
    viewerAvailable = Boolean(viewer);
  }
  showPart('cutter');
  $('preview-parts').hidden = !result.stamp || $('viewer').hidden;
  const format = value => +value.toFixed(2);
  $('model-status').textContent =
    `Cookie ${format(result.cookieWidth)} × ${format(result.cookieHeight)} mm · Cutter footprint ${format(result.width)} × ${format(result.height)} mm · Cutter height ${format(result.depth)} mm.` +
    (result.issues.length ? ' Amber areas show tight details or rounded corners. Increase the cookie size or smooth the outline if those details matter.' : '') +
    ($('viewer').hidden ? ' 3D preview unavailable on this device.' : '');
  refreshDownloads();
  $('stamp-status').textContent = result.stamp
    ? 'Stamp ready. Select Show stamp to see the print and the matching marks on your artwork.'
    : result.stampError || 'No printable interior details found. Adjust the stamp threshold or try light details.';
}

$('build').onclick = () => {
  const points = activeOutline();
  if (!points || draft || worker) return;
  invalidate();
  worker = new Worker(new URL('./geometry-worker.js', import.meta.url), {type: 'module'});
  const current = worker;
  const finish = result => {
    if (worker !== current) return;
    current.terminate();
    worker = undefined;
    clearTimeout(timer);
    present({...result, stampError: stampError || result.stampError});
    renderOutline();
  };
  worker.onmessage = ({data}) => finish(data);
  worker.onerror = () => finish({error: 'The geometry engine could not start.'});
  worker.onmessageerror = () => finish({error: 'The browser could not read the cutter mesh.'});
  timer = setTimeout(() => finish({error: 'The cutter took too long to build. Try more smoothing.'}), 90000);
  let stampPaths, stampError;
  try {
    stampPaths = detectStamp(image, $('stamp-threshold').valueAsNumber, $('stamp-invert').checked,
      Number($('smoothing').value), pathContours);
  } catch (error) {
    stampError = error.message;
  }
  worker.postMessage({points, stampPaths, axis: sizingAxis, size: $(sizingAxis).valueAsNumber, geometryScript: assets['stl-geometry.js'],
    height: $('cutter-height').valueAsNumber, wall: $('wall').valueAsNumber, stampDepth: $('stamp-depth').valueAsNumber});
  $('model-status').textContent = 'Building and checking the cutter…';
  renderOutline();
};

$('sample').onclick = () => void load();
$('file').onchange = event => { if (event.target.files[0]) void load(event.target.files[0]); };
$('drop').ondragover = event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  $('drop').classList.add('over');
};
$('drop').ondragleave = event => { if (!$('drop').contains(event.relatedTarget)) $('drop').classList.remove('over'); };
$('drop').ondrop = event => {
  event.preventDefault();
  $('drop').classList.remove('over');
  if (event.dataTransfer.files[0]) void load(event.dataTransfer.files[0]);
};
for (const id of ['threshold', 'invert', 'smoothing']) $(id).onchange = () => refreshTrace();
$('shape').onchange = $('use-trace').onclick = () => {
  draft = manual = undefined;
  history = [];
  refreshTrace();
};
$('draw').onclick = () => changeDraft([], false);
$('edit').onclick = () => changeDraft(activeOutline().map(point => [...point]), true);
$('undo').onclick = () => {
  if (history.length) draft.points = history.pop();
  renderOutline();
};
$('close').onclick = () => {
  if (!draft || draft.points.length < 3) return;
  manual = draft.points;
  draft = undefined;
  history = [];
  $('trace-status').textContent = 'Custom outline selected. Confirm it to build the cutter.';
  syncSize();
  renderOutline();
};
for (const id of ['width', 'height', 'cutter-height', 'wall', 'stamp-threshold', 'stamp-invert', 'stamp-depth']) $(id).oninput = () => {
  if (id === 'width' || id === 'height') {
    sizingAxis = id;
    syncSize();
  }
  invalidate();
  renderOutline();
};
$('zoom-in').onclick = () => viewer?.zoomBy(1.2);
$('zoom-out').onclick = () => viewer?.zoomBy(1 / 1.2);
$('reset').onclick = () => viewer?.reset();
const exportsByPart = {
  cutter: {id: 'download', title: 'cutter', filename: 'coasterprint-cookie-cutter'},
  stamp: {id: 'download-stamp', title: 'stamp', filename: 'coasterprint-cookie-stamp'},
  handle: {id: 'download-handle', title: 'ring handle', filename: 'coasterprint-stamp-ring-handle'}
};
let exporting = false;

function refreshDownloads() {
  const label = $('export-format').value.toUpperCase();
  for (const [part, {id, title}] of Object.entries(exportsByPart)) {
    $(id).textContent = `Download ${title} ${label}`;
    $(id).disabled = exporting || !(part === 'cutter' ? model : model?.stamp);
  }
}

$('export-format').onchange = refreshDownloads;
for (const [part, {id, title, filename}] of Object.entries(exportsByPart)) {
  $('view-' + part).onclick = () => {
    if (part === 'cutter' ? model : model?.stamp) showPart(part);
  };
  $(id).onclick = async () => {
    const selected = {cutter: model, stamp: model?.stamp, handle: model?.stamp?.handle}[part];
    if (!selected || exporting) return;
    const status = $('download-status');
    status.textContent = '';
    if ($('export-format').value === 'stl') {
      downloadFile(filename + '.stl', selected.buffer, 'model/stl');
      return;
    }
    const current = model;
    exporting = true;
    refreshDownloads();
    status.textContent = 'Preparing 3MF…';
    try {
      const {bytes} = await project3MF([{name: 'CoasterPrint ' + title, buffer: selected.buffer,
        bounds: {min: [0, 0], max: [selected.width, selected.height]}}], {
        application: 'CoasterPrint Cookie Cutter Maker', centerSingle: true
      });
      if (model === current) {
        downloadFile(filename + '.3mf', bytes, 'model/3mf');
        status.textContent = '';
      }
    } catch {
      if (model === current) status.textContent = 'Could not create the 3MF. Try again or choose STL.';
    } finally {
      exporting = false;
      refreshDownloads();
    }
  };
}
