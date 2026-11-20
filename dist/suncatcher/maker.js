import {decodeArtwork, flowerSample, matchAssignments, traceArtwork} from './trace.js';
import {download, project3MF, stlZip} from './downloads.js';

const $ = id => document.getElementById(id);
const palette = ['#e3a91b', '#ed7950', '#e8b955', '#4a9b81', '#50a8b8', '#8c77bc', '#d673a0'];
const defaultAssignment = ({id, color}) => ({color: color || palette[(id - 1) % palette.length], open: false});
const traceCanvas = $('trace');
const assembled = $('assembled');
const dimensionFields = ['size-axis', 'size', 'frame', 'insert', 'clearance', 'loop'];
let source, sourceTitle, trace, selected, result, settings, renderTimer, worker, downloadBusy = false;
let imageVersion = 0, version = 0, requested = 0, recoveryVersion;
let assignments = new Map();
const modelURLs = [];

function modelSettings() {
  for (const name of ['size', 'frame', 'insert', 'clearance']) {
    const input = $(name);
    if (input.value === '' || input.valueAsNumber < Number(input.min) || input.valueAsNumber > Number(input.max)) {
      throw Error('Enter values within the ranges shown in Size and fit.');
    }
  }
  const frame = $('frame').valueAsNumber, insert = $('insert').valueAsNumber;
  if (insert + 0.8 > frame + 1e-6) throw Error('The insert must fit behind the 0.8 mm front lip. Increase frame depth or reduce insert thickness.');
  return {axis: $('size-axis').value, size: $('size').valueAsNumber, frame, insert,
    clearance: $('clearance').valueAsNumber, loop: $('loop').checked};
}

function diagnostic(messages) {
  const items = messages.map(message => {
    const item = document.createElement('li');
    item.textContent = message;
    return item;
  });
  const list = document.createElement('ul');
  list.append(...items);
  $('diagnostics').replaceChildren(...(items.length ? [list] : []));
}

function updateButtons() {
  $('download').disabled = downloadBusy || !result?.frame;
  $('download-3mf').disabled = downloadBusy || !result?.frame;
  $('coupon').disabled = downloadBusy || result?.coupon.length !== 2;
}

function redrawTrace() {
  if (!trace) return;
  const {width, height, labels, regions, leaks} = trace;
  traceCanvas.width = width;
  traceCanvas.height = height;
  const context = traceCanvas.getContext('2d');
  const pixels = context.createImageData(width, height);
  const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const colors = regions.map(({id}) => {
    const assignment = assignments.get(id);
    return assignment.open ? [252, 251, 246] : rgb(assignment.color);
  });
  const exterior = [243, 239, 229], wall = [41, 40, 40], leak = [247, 184, 95];
  const outline = regions.length ? wall : leak;
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    const color = id < 0 ? outline : id === 0 ? (leaks[i] ? leak : exterior) : colors[id - 1];
    pixels.data[i * 4] = color[0];
    pixels.data[i * 4 + 1] = color[1];
    pixels.data[i * 4 + 2] = color[2];
    pixels.data[i * 4 + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  for (const region of regions) {
    if (region.area > 25 || region.id === selected) marker(context, number(region.id), region.x, region.y, region.id === selected);
  }
}

function marker(context, id, x, y, active = false) {
  context.font = 'bold 11px system-ui';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const width = Math.max(15, context.measureText(String(id)).width + 6);
  context.fillStyle = active ? '#f9e064' : '#191919';
  context.beginPath();
  context.roundRect(x - width / 2, y - 7.5, width, 15, 6);
  context.fill();
  context.fillStyle = active ? '#191919' : '#fff';
  context.fillText(String(id), x, y);
}

function selectRegion(id) {
  selected = id;
  const assignment = assignments.get(id);
  $('region').value = id ?? '';
  $('color').disabled = !assignment || assignment.open;
  $('open').disabled = !assignment;
  $('open').checked = Boolean(assignment?.open);
  if (assignment) $('color').value = assignment.color;
  $('region-status').textContent = trace?.regions.length ?
    `${trace.regions.length} enclosed region${trace.regions.length === 1 ? '' : 's'} detected.` : 'No enclosed regions detected.';
  redrawTrace();
}

function clearModel(message) {
  result = null;
  for (const url of modelURLs.splice(0)) URL.revokeObjectURL(url);
  $('parts').replaceChildren();
  $('part-summary').textContent = message;
  $('footprint').textContent = '';
  $('download-status').textContent = '';
  assembled.width = 300;
  assembled.height = 190;
  updateButtons();
}

function traceSource(reset = false, reduced = false) {
  if (!source) return;
  clearTimeout(renderTimer);
  clearModel('Building printable parts…');
  version++;
  try {
    const previous = reset ? null : trace;
    const next = traceArtwork(source, $('threshold').valueAsNumber, $('smooth').valueAsNumber,
      $('gap').valueAsNumber, $('trace-mode').value, Number($('trace-detail').value));
    if (next.regions.length > 150) throw Error('More than 150 regions detected. Increase smoothing, close gaps, or simplify the artwork.');
    trace = next;
    assignments = matchAssignments(previous, next, assignments, defaultAssignment);
    if (reset || !assignments.has(selected)) selected = next.regions[0]?.id;
    const region = $('region');
    region.replaceChildren(...next.regions.map(({id}) => new Option('Insert ' + number(id), id)));
    if (!next.regions.length) region.add(new Option('No enclosed regions'));
    region.disabled = !next.regions.length;
    selectRegion(selected);
    if (!next.regions.length) $('artwork-status').textContent = 'No closed regions. Try Close gaps or use artwork with closed outlines.';
    else $('artwork-status').textContent = reduced ?
      sourceTitle + ' · Retrying at medium detail. Check the numbered regions before exporting.' : sourceTitle;
    queueModel();
  } catch (error) {
    trace = null;
    traceCanvas.width = 300;
    traceCanvas.height = 190;
    $('region').replaceChildren(new Option('No regions yet'));
    $('region').disabled = true;
    assignments.clear();
    selectRegion(undefined);
    $('artwork-status').textContent = error.message;
    diagnostic([]);
    clearModel('Adjust the trace to build parts.');
  }
}

function queueModel() {
  clearTimeout(renderTimer);
  version++;
  if (!trace) return;
  clearModel('Building printable parts…');
  diagnostic([]);
  renderTimer = setTimeout(sendModel, 150);
}

function sendModel() {
  if (!trace || requested) return;
  try {
    settings = modelSettings();
    if (!worker) {
      worker = new Worker(new URL('./geometry-worker.js', import.meta.url), {type: 'module'});
      worker.onmessage = receiveModel;
      worker.onerror = () => {
        requested = 0;
        worker.terminate();
        worker = null;
        diagnostic(['The geometry engine could not load. Reload the page and try again.']);
        clearModel('Model unavailable.');
      };
    }
    requested = version;
    worker.postMessage({id: version, trace, settings, assignments: Object.fromEntries(assignments)});
  } catch (error) {
    diagnostic([error.message]);
    clearModel('Adjust the settings to build parts.');
  }
}

function receiveModel({data: {id, result: built, error, resetWorker}}) {
  requested = 0;
  if (resetWorker) {
    worker.terminate();
    worker = null;
  }
  if (id !== version) {
    clearTimeout(renderTimer);
    sendModel();
    return;
  }
  if (error) {
    if (resetWorker && $('trace-detail').value === '420') {
      $('trace-detail').value = '300';
      traceSource(false, true);
      recoveryVersion = version;
      return;
    }
    diagnostic([resetWorker ? 'The geometry engine hit a memory error. Lower Trace detail and check the preview before exporting.' : error]);
    clearModel('Adjust the trace to build parts.');
    return;
  }
  if (id === recoveryVersion) {
    $('artwork-status').textContent = sourceTitle + ' · Rebuilt at medium detail. Check the numbered regions before exporting.';
  }
  result = built;
  displayModel();
}

const number = id => String(id).padStart(2, '0');
const millimeters = value => value.toFixed(1);

function drawPolygons(context, polygons, transform, color) {
  context.beginPath();
  for (const polygon of polygons) {
    context.moveTo(...transform(polygon[0]));
    for (let i = 1; i < polygon.length; i++) context.lineTo(...transform(polygon[i]));
    context.closePath();
  }
  context.fillStyle = color;
  context.fill('evenodd');
}

function projection(canvas, bounds, square = false) {
  const {min, max} = bounds;
  const w = max[0] - min[0], h = max[1] - min[1];
  const scale = (square ? 120 : 410) / Math.max(w, h);
  const pad = square ? 10 : 15;
  canvas.width = square ? 140 : Math.max(60, Math.ceil(w * scale + 2 * pad));
  canvas.height = square ? 140 : Math.max(60, Math.ceil(h * scale + 2 * pad));
  const x = (canvas.width - w * scale) / 2;
  const y = (canvas.height - h * scale) / 2;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f3efe5';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return {context, map: point => [x + (point[0] - min[0]) * scale, y + (max[1] - point[1]) * scale]};
}

function drawAssembly(canvas, showDiagnostics, backView = false) {
  const {context, map: project} = projection(canvas, result.footprint);
  const map = point => {
    const [x, y] = project(point);
    return [backView ? canvas.width - x : x, y];
  };
  for (const part of result.inserts) drawPolygons(context, part.polygons, map, part.color);
  drawPolygons(context, result.front, map, '#292828');
  if (showDiagnostics) {
    drawPolygons(context, result.thin, map, '#e15350');
    drawPolygons(context, result.detached, map, '#8c58b9');
    for (const part of result.dropped) drawPolygons(context, part.polygons, map, '#f7b85f');
  }
  const {minX, maxY} = trace.bounds;
  const {pitch} = result;
  const ids = new Set([...result.inserts, ...(showDiagnostics ? result.dropped : [])].map(part => part.id));
  for (const region of trace.regions) {
    if (ids.has(region.id)) marker(context, number(region.id), ...map([(region.x - minX) * pitch, (maxY - region.y) * pitch]));
  }
}

function partCard(part, label, polygons, color) {
  const card = document.createElement('div');
  card.className = 'part';
  const title = document.createElement('strong');
  title.textContent = label;
  const picture = document.createElement('canvas');
  picture.setAttribute('aria-label', label + ' outline');
  const {context, map} = projection(picture, part.previewBounds, true);
  drawPolygons(context, polygons, map, color);
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([part.buffer], {type: 'model/stl'}));
  modelURLs.push(url);
  link.href = url;
  link.download = part.name + '.stl';
  link.textContent = 'STL';
  link.setAttribute('aria-label', 'Download ' + label + ' STL');
  card.append(title, picture, link);
  return card;
}

function displayModel() {
  const {min, max} = result.footprint;
  $('footprint').textContent = `Finished footprint${settings.loop ? ' with loop' : ''} · ${millimeters(max[0] - min[0])} × ${millimeters(max[1] - min[1])} mm · ${settings.frame} mm deep`;
  diagnostic([...result.problems, ...result.warnings]);
  drawAssembly(assembled, true);
  const cards = result.frame ? [partCard(result.frame, 'Frame', result.front, '#292828')] : [];
  for (const part of result.inserts) cards.push(partCard(part, 'Insert ' + number(part.id), part.polygons, part.color));
  $('parts').replaceChildren(...cards);
  $('part-summary').textContent = result.frame ?
    `Watertight frame and ${result.inserts.length} validated insert${result.inserts.length === 1 ? '' : 's'}.` :
    'Fix the frame warnings before downloading a complete design.';
  updateButtons();
}

function editRegion(patch) {
  if (!assignments.has(selected)) return;
  assignments.set(selected, {...assignments.get(selected), ...patch});
  selectRegion(selected);
  queueModel();
}

function useImage(image, title) {
  source?.close?.();
  source = image;
  sourceTitle = title;
  traceSource(true);
}

$('sample').onclick = () => {
  imageVersion++;
  $('artwork').value = '';
  useImage(flowerSample(), 'Flower sample');
};
$('artwork').onchange = async event => {
  const [file] = event.target.files;
  if (!file) return;
  const current = ++imageVersion;
  $('artwork-status').textContent = 'Reading artwork…';
  try {
    const image = await decodeArtwork(file);
    if (current === imageVersion) useImage(image, file.name);
    else image.close?.();
  } catch (error) {
    if (current === imageVersion) $('artwork-status').textContent = 'Could not read the artwork. ' + error.message;
  }
  if (current === imageVersion) $('artwork').value = '';
};
for (const [field, output, unit] of [['threshold', 'threshold-value', ''], ['smooth', 'smooth-value', ' px'], ['gap', 'gap-value', ' px']]) {
  $(field).oninput = () => {
    $(output).textContent = $(field).value + unit;
    traceSource();
  };
}
$('trace-mode').onchange = $('trace-detail').onchange = () => traceSource();
for (const field of dimensionFields) $(field).oninput = queueModel;
$('region').onchange = () => selectRegion(Number($('region').value));
$('open').onchange = () => editRegion({open: $('open').checked});
$('color').onchange = () => editRegion({color: $('color').value, customColor: true});
traceCanvas.onclick = event => {
  if (!trace) return;
  const rect = traceCanvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) * trace.width / rect.width);
  const y = Math.floor((event.clientY - rect.top) * trace.height / rect.height);
  if (x < 0 || y < 0 || x >= trace.width || y >= trace.height) return;
  const id = trace.labels[y * trace.width + x];
  if (id > 0) selectRegion(id);
};

function notes(model, options) {
  return [
    'CoasterPrint Suncatcher Maker', '',
    'STL coordinates are millimeters. All parts have their flat print face at Z=0.',
    'Print the frame flat with the front lip on the build plate. Print the inserts separately in the chosen filaments.',
    'Match the numbered pieces to the assembly map (back view). Place the frame face down and seat the inserts from the back.',
    'The lip stops the inserts passing through to the front. A small amount of compatible adhesive can secure the inserts from the back.',
    'Print the fit coupon before the full set. Use the same material, first-layer settings, and orientations as the finished design.',
    `Clearance: ${options.clearance} mm per side. Frame depth: ${options.frame} mm. Insert thickness: ${options.insert} mm.`, '',
    ...model.inserts.map(part => `Insert ${number(part.id)}: ${part.color}`), ...model.warnings
  ].join('\n');
}

async function exportFiles(kind) {
  if (downloadBusy || !result) return;
  const model = result, options = settings, current = version;
  downloadBusy = true;
  updateButtons();
  $('download-status').textContent = 'Preparing download…';
  try {
    const parts = [model.frame, ...model.inserts];
    if (kind === '3mf') {
      const project = await project3MF(parts);
      download('suncatcher.3mf', project.bytes, 'model/3mf');
      if (current === version) $('download-status').textContent = project.oversized ?
        '3MF downloaded. Move objects to separate plates or use the individual STLs if the set exceeds your bed.' :
        '3MF downloaded. Print colors in separate jobs for assembly without an AMS.';
    } else {
      const couponOnly = kind === 'coupon';
      let map;
      if (!couponOnly) {
        const picture = document.createElement('canvas');
        drawAssembly(picture, false, true);
        map = await new Promise(resolve => picture.toBlob(resolve, 'image/png'));
      }
      const bytes = await stlZip(couponOnly ? model.coupon : [...parts, ...model.coupon], notes(model, options), map);
      download(couponOnly ? 'suncatcher-fit-coupon.zip' : 'suncatcher-stl.zip', bytes, 'application/zip');
      if (current === version) $('download-status').textContent = 'ZIP downloaded.';
    }
  } catch (error) {
    if (current === version) $('download-status').textContent = 'Download failed. ' + error.message;
  } finally {
    downloadBusy = false;
    updateButtons();
  }
}
$('download').onclick = () => void exportFiles('stl');
$('download-3mf').onclick = () => void exportFiles('3mf');
$('coupon').onclick = () => void exportFiles('coupon');
