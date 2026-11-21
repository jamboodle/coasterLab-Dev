import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withStatic} from '../server/static.mjs';
import {handler} from '../server/app.mjs';
import {Ledger} from '../server/ledger.mjs';
import {modelPayload} from '../tests/export-fixture.mjs';
import {stlMeshXML} from '../dist/shared/stl-mesh.js';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const {unzipSync} = require('../dist/vendor/fflate.js');
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const ledger = new Ledger(':memory:');
const account = ledger.registerIdentity('cookie@example.com', 'salt', 'digest');
ledger.saveSettings(account, {billingEnabled: true});
const session = ledger.createSession(account);
const server = createServer(withStatic((req, res) => handler({ledger, origin, customerAccounts: true})(req, res), root));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.03, `${actual} vs ${expected}`);

function inspect(bytes, expected) {
  const count = bytes.readUInt32LE(80);
  assert.equal(bytes.length, 84 + count * 50);
  const edges = new Map(), topEdges = new Map(), vertices = new Map(), graph = new Map();
  const heights = new Set();
  function link(map, a, b) {
    const key = [a, b].sort().join('|');
    map.set(key, (map.get(key) || 0) + 1);
  }
  for (let i = 0; i < count; i++) {
    const ids = [];
    for (let j = 0; j < 3; j++) {
      const offset = 96 + 50 * i + 12 * j;
      const point = [0, 4, 8].map(delta => bytes.readFloatLE(offset + delta));
      const id = point.join(',');
      ids.push(id);
      vertices.set(id, point);
      heights.add(point[2]);
    }
    assert.equal(new Set(ids).size, 3);
    const top = ids.every(id => vertices.get(id)[2] === expected.depth);
    for (let j = 0; j < 3; j++) {
      const a = ids[j], b = ids[(j + 1) % 3];
      link(edges, a, b);
      if (top) link(topEdges, a, b);
      if (!graph.has(a)) graph.set(a, new Set());
      if (!graph.has(b)) graph.set(b, new Set());
      graph.get(a).add(b);
      graph.get(b).add(a);
    }
  }
  assert.ok([...edges.values()].every(value => value === 2), 'STL is watertight');
  const connected = new Set([graph.keys().next().value]);
  for (const id of connected) for (const child of graph.get(id)) connected.add(child);
  assert.equal(connected.size, graph.size, 'only one mesh component');
  assert.equal(Math.min(...heights), 0);
  near(Math.max(...heights), expected.depth);
  if (expected.stamp) {
    assert.ok([...heights].some(z => z > 4.35 && z < 4.45), 'blind socket is recessed into the backing');
    assert.ok([...heights].some(z => z > 1 && z < 4.35), 'socket contains helical thread geometry');
    if (expected.imprint) assert.ok([...heights].some(z => Math.abs(z - 0.28) < .00001),
      'stamp underside contains the 0.28 mm watermark recess');
    const relief = [...vertices.values()].filter(point => point[2] > 5.61);
    assert.ok(relief.length > 3, 'raised stamp detail is present');
    if (expected.markOnRight) {
      const width = Math.max(...[...vertices.values()].map(point => point[0]));
      assert.ok(relief.every(point => point[0] > width / 2), 'left-side artwork is mirrored on the stamp');
    }
    return;
  }
  if (expected.handle) {
    assert.ok([...heights].filter(z => z > 29.1).length >= 45, 'post contains helical thread geometry');
    return;
  }
  assert.deepEqual([...heights].sort((a, b) => a - b), [0, Math.fround(1.6), expected.depth], 'lip is only at the handling end');
  const rim = new Map();
  for (const [edge, count] of topEdges) {
    if (count !== 1) continue;
    const [a, b] = edge.split('|');
    if (!rim.has(a)) rim.set(a, new Set());
    if (!rim.has(b)) rim.set(b, new Set());
    rim.get(a).add(b);
    rim.get(b).add(a);
  }
  const loops = [];
  const unseen = new Set(rim.keys());
  for (const seed of unseen) {
    const loop = new Set([seed]);
    for (const id of loop) {
      assert.equal(rim.get(id).size, 2);
      for (const next of rim.get(id)) loop.add(next);
      unseen.delete(id);
    }
    loops.push([...loop].map(id => vertices.get(id)));
  }
  assert.equal(loops.length, 2, 'cutting edge consists of an inside and outside loop');
  const span = (points, axis) => {
    const values = points.map(point => point[axis]);
    return Math.max(...values) - Math.min(...values);
  };
  near(Math.min(...loops.map(loop => span(loop, 0))), expected.cookieWidth);
  near(Math.min(...loops.map(loop => span(loop, 1))), expected.cookieHeight);
  assert.ok(expected.width - Math.max(...loops.map(loop => span(loop, 0))) > 2.3, 'lip is wider than the cutting edge');
  near(span([...vertices.values()], 0), expected.width);
  near(span([...vertices.values()], 1), expected.height);
}

let browser;
try {
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']});
  const page = await browser.newPage({acceptDownloads: true, viewport: {width: 1200, height: 920}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('link', {name: 'Cookie Cutter Maker', exact: true}).click();
  await page.waitForURL(origin + '/cookie-cutter/');
  const traceStatus = page.locator('#trace-status');
  const modelStatus = page.locator('#model-status');
  const output = process.env.CUTTER_VERIFY_OUTPUT;
  if (output) await mkdir(output, {recursive: true});
  async function build(name, requested) {
    await page.locator('#build').click();
    await page.waitForFunction(() => !document.querySelector('#build').disabled, null, {timeout: 20000});
    const status = await modelStatus.textContent();
    const match = /Cookie ([\d.]+) × ([\d.]+) mm · Cutter footprint ([\d.]+) × ([\d.]+) mm · Cutter height ([\d.]+) mm/.exec(status);
    assert.ok(match, status);
    const [cookieWidth, cookieHeight, width, height, depth] = match.slice(1).map(Number);
    near(requested.axis === 'height' ? cookieHeight : cookieWidth, requested.size);
    assert.ok(width > cookieWidth && height > cookieHeight);
    await page.locator('#viewer').waitFor({state: 'visible'});
    const [file] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
    assert.equal(file.suggestedFilename(), 'coasterprint-cookie-cutter.stl');
    const bytes = await readFile(await file.path());
    inspect(bytes, {cookieWidth, cookieHeight, width, height, depth});
    if (output) await writeFile(join(output, name + '.stl'), bytes);
    return bytes;
  }
  assert.equal(await page.locator('#stamp-mode').inputValue(), 'color');
  await page.locator('#stamp-mode').selectOption('lines');
  await page.locator('#sample').click();
  await page.waitForFunction(() => document.querySelector('#trace-status').textContent.includes('1 detected shape'));
  await build('sample-star', {axis: 'width', size: 80});
  assert.equal(await page.locator('#stamp-depth').inputValue(), '3');
  const meshes = [];
  for (const id of ['download', 'download-stamp', 'download-handle']) {
    const [stl] = await Promise.all([page.waitForEvent('download'), page.locator('#' + id).click()]);
    const solid = await readFile(await stl.path());
    meshes.push(stlMeshXML(Uint8Array.from(solid).buffer).xml);
  }
  const dialog = page.getByRole('dialog');
  await page.locator('#download-project').click();
  await dialog.getByText(/Log in or create an account to download 3MF/).waitFor();
  await dialog.getByRole('button', {name: 'Switch to free STL'}).click();
  await dialog.waitFor({state: 'detached'});
  assert.equal(ledger.balance(account), 15);
  await page.context().addCookies([{name: 'cl_session', value: session, url: origin}]);

  async function downloadProject(cost) {
    const balance = ledger.balance(account);
    await page.locator('#download-project').click();
    const confirm = dialog.getByRole('button', {name: cost ? /Confirm · 1 credit/ : 'Prepare free download'});
    await confirm.waitFor();
    assert.match(await dialog.locator('[data-summary]').textContent(), /1 cookie cutter set/);
    assert.equal(ledger.balance(account), balance);
    await confirm.click();
    const [file] = await Promise.all([
      page.waitForEvent('download'), dialog.getByRole('button', {name: 'Download Ready'}).click()
    ]);
    await dialog.getByRole('button', {name: 'Close export confirmation'}).click();
    await dialog.waitFor({state: 'detached'});
    assert.equal(ledger.balance(account), balance - cost);
    return file;
  }
  const project = await downloadProject(1);
  await downloadProject(0);
  const coaster = await page.request.post(origin + '/api/exports', {data: modelPayload(), headers: {Origin: origin}});
  assert.equal(coaster.status(), 201);
  const coasterQuote = await coaster.json();
  assert.equal(coasterQuote.balance, 14, 'coaster exports see the same balance after the cookie set debit');
  assert.equal(project.suggestedFilename(), 'coasterprint-cookie-cutter-set.3mf');
  const bytes = await readFile(await project.path());
  const projectFiles = unzipSync(new Uint8Array(bytes));
  const xml = Buffer.from(projectFiles['3D/3dmodel.model']).toString();
  const metadata = Buffer.from(projectFiles['Metadata/model_settings.config']).toString();
  const preset = JSON.parse(Buffer.from(projectFiles['Metadata/project_settings.config']).toString());
  assert.match(xml, /unit="millimeter"/);
  assert.match(xml, /CoasterPrint Cookie Cutter Maker/);
  assert.equal((xml.match(/<item objectid=/g) || []).length, 3);
  assert.equal((metadata.match(/<plate>/g) || []).length, 1);
  assert.equal((metadata.match(/<model_instance>/g) || []).length, 3);
  assert.equal(preset.printer_model, 'Bambu Lab P1S');
  assert.equal(Number(preset.layer_height), 0.2);
  assert.equal(preset.filament_colour.length, 1);
  for (const mesh of meshes) assert.ok(xml.includes(mesh), 'plate includes each unmodified STL mesh');
  if (output) await writeFile(join(output, 'cookie-cutter-set.3mf'), bytes);
  async function checkStamp(name) {
    assert.equal(await page.locator('#download-stamp').isEnabled(), true, await page.locator('#stamp-status').textContent());
    await page.locator('#view-stamp').click();
    assert.equal(await page.locator('#viewer').getAttribute('aria-label'), 'Rotatable stamp preview');
    assert.equal(await page.locator('#overlay .stamp-mark').count(), 1);
    const [file] = await Promise.all([page.waitForEvent('download'), page.locator('#download-stamp').click()]);
    assert.equal(file.suggestedFilename(), 'coasterprint-cookie-stamp.stl');
    const bytes = await readFile(await file.path());
    inspect(bytes, {stamp: true, depth: 8.6, imprint: name === 'sample-star-stamp', markOnRight: name === 'transparent-circle-stamp'});
    if (output) await writeFile(join(output, name + '.stl'), bytes);
    if (name === 'transparent-circle-stamp') {
      const [center, border, fineLine] = await page.locator('.stamp-mark').evaluate(path =>
        [[84, 118], [79.5, 118], [65.5, 118]].map(([x, y]) => path.isPointInFill(new DOMPoint(x, y))));
      assert.equal(center, false, 'broad fill center does not emboss');
      assert.equal(border, true, 'the broad fill keeps an embossable contour');
      assert.equal(fineLine, true, 'thin marks keep their original fill');
    }
    await page.locator('#view-cutter').click();
  }
  await checkStamp('sample-star-stamp');
  await page.locator('#view-handle').click();
  assert.equal(await page.locator('#viewer').getAttribute('aria-label'), 'Rotatable handle preview');
  const [handle] = await Promise.all([page.waitForEvent('download'), page.locator('#download-handle').click()]);
  assert.equal(handle.suggestedFilename(), 'coasterprint-stamp-ring-handle.stl');
  const handleBytes = await readFile(await handle.path());
  inspect(handleBytes, {handle: true, depth: 32.8});
  const fit = await page.evaluate(async () => {
    const [{default: Module}, {backingHeight, stampHandle, stampSocket}] = await Promise.all([
      import('/vendor/manifold.js'), import('/cookie-cutter/stamp-handle.js')
    ]);
    const kernel = await Module({locateFile: name => '/vendor/' + name});
    kernel.setup();
    const owned = [];
    const keep = value => { owned.push(value); return value; };
    try {
      const backing = keep(kernel.CrossSection.square([60, 60], true));
      const socket = stampSocket(kernel, keep, backing);
      const plate = keep(keep(backing.extrude(backingHeight)).subtract(socket));
      const {solid, width, height} = stampHandle(kernel, keep);
      const centered = keep(solid.translate([-width / 2, -height / 2, -29]));
      const partlyInserted = keep(keep(centered.rotate([0, 0, -180])).translate([0, 0, -0.9]));
      const finger = keep(keep(keep(kernel.Manifold.cylinder(14, 9.5, 9.5, 40))
        .rotate([90, 0, 0])).translate([0, 7, -17]));
      return [centered, partlyInserted].map(handle => keep(plate.intersect(handle)).volume())
        .concat(keep(finger.intersect(centered)).volume());
    } finally {
      for (const value of owned.reverse()) value.delete();
    }
  });
  assert.ok(fit.every(volume => volume < 0.001), 'threads mesh without interference and a 19 mm finger fits through');
  if (output) await writeFile(join(output, 'ring-handle.stl'), handleBytes);
  await page.locator('#view-cutter').click();
  const viewer = page.locator('#viewer');
  const before = await viewer.screenshot();
  await viewer.press('ArrowRight');
  assert.ok(!before.equals(await viewer.screenshot()), '3D preview can rotate');

  async function upload(jpg) {
    const data = await page.evaluate(jpg => {
      const canvas = Object.assign(document.createElement('canvas'), {width: 280, height: 240});
      const ctx = canvas.getContext('2d');
      if (jpg) { ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, 280, 240); }
      ctx.fillStyle = jpg ? '#fff' : '#0a9958';
      ctx.beginPath();
      ctx.arc(108, 120, 82, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillRect(214, 92, 40, 57);
      if (!jpg) {
        ctx.fillStyle = '#242424';
        ctx.fillRect(78, 100, 13, 35);
        ctx.fillRect(64, 103, 3, 28);
      }
      return canvas.toDataURL(jpg ? 'image/jpeg' : 'image/png', .92).split(',')[1];
    }, jpg);
    await page.locator('#file').setInputFiles({name: jpg ? 'circle.jpg' : 'circle.png',
      mimeType: jpg ? 'image/jpeg' : 'image/png', buffer: Buffer.from(data, 'base64')});
  }
  await upload(false);
  await page.waitForFunction(() => document.querySelector('#trace-status').textContent.includes('2 detected shapes'));
  assert.match(await traceStatus.textContent(), /transparency/);
  await page.locator('#shape').selectOption('1');
  await page.locator('#height').fill('45');
  await build('transparent-second-shape', {axis: 'height', size: 45});
  await page.locator('#shape').selectOption('0');
  await page.locator('#height').fill('65');
  await build('transparent-circle', {axis: 'height', size: 65});
  await checkStamp('transparent-circle-stamp');

  await upload(true);
  await page.locator('#invert').waitFor({state: 'visible'});
  assert.match(await traceStatus.textContent(), /brightness threshold/);
  await page.locator('#threshold').fill('180');
  await page.locator('#invert').check();
  await page.locator('#smoothing').selectOption('3');
  await page.waitForFunction(() => document.querySelector('#trace-status').textContent.includes('2 detected shapes'));
  await page.locator('#width').fill('60');
  await build('inverted-jpg-circle', {axis: 'width', size: 60});
  assert.equal(await page.locator('#download-stamp').isDisabled(), true, 'plain silhouettes export only the cutter');
  const cutterProject = await downloadProject(1);
  const cutterFiles = unzipSync(new Uint8Array(await readFile(await cutterProject.path())));
  assert.equal((Buffer.from(cutterFiles['3D/3dmodel.model']).toString().match(/<item objectid=/g) || []).length, 1);

  await page.locator('#edit').click();
  await page.locator('[data-point="0"]').press('ArrowRight');
  await page.locator('#undo').click();
  await page.locator('#close').click();
  await build('edited-circle', {axis: 'width', size: 60});

  async function draw(points) {
    await page.locator('#draw').click();
    const overlay = page.locator('#overlay');
    const box = await overlay.boundingBox();
    for (const [x, y] of points) await overlay.click({position: {x: x * box.width, y: y * box.height}});
    await page.locator('#close').click();
  }
  await draw([[.2,.2],[.7,.7],[.2,.7],[.7,.2]]);
  await page.locator('#build').click();
  await page.waitForFunction(() => document.querySelector('#model-status').textContent.includes('crosses itself'));
  assert.equal(await page.locator('#download').isDisabled(), true);
  assert.equal(await page.locator('#overlay .invalid').count(), 3);
  await draw([[.25,.2],[.65,.2],[.62,.38],[.75,.63],[.44,.8],[.25,.6]]);
  await build('drawn-outline', {axis: 'width', size: 60});
  const colored = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement('canvas'), {width: 240, height: 220});
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffe9a0';
    ctx.beginPath();
    ctx.arc(120, 110, 95, 0, 2 * Math.PI);
    ctx.fill();
    // No dark strokes. The green and blue are close in brightness and touch along x=120.
    ctx.fillStyle = '#64ba75';
    ctx.fillRect(70, 78, 50, 64);
    ctx.fillStyle = '#93a7ed';
    ctx.fillRect(120, 78, 50, 64);
    return canvas.toDataURL().split(',')[1];
  });
  await page.locator('#file').setInputFiles({name: 'flat-colors.png', mimeType: 'image/png', buffer: Buffer.from(colored, 'base64')});
  await page.waitForFunction(() => document.querySelector('#trace-status').textContent.includes('1 detected shape'));
  await page.locator('#width').fill('80');
  const originalCutter = await build('flat-colors-cutter', {axis: 'width', size: 80});
  assert.equal(await page.locator('#download-stamp').isDisabled(), true);
  await page.locator('#stamp-mode').selectOption('color');
  assert.equal(await page.locator('#stamp-colors').isVisible(), true);
  assert.equal(await page.locator('#stamp-threshold').isVisible(), false);
  const colorModeCutter = await build('flat-colors-cutter', {axis: 'width', size: 80});
  assert.ok(Buffer.isBuffer(originalCutter) && originalCutter.equals(colorModeCutter), 'stamp mode preserves the exact cutter STL');
  await checkStamp('flat-colors-stamp');
  await page.locator('#view-stamp').click();
  const marks = await page.locator('.stamp-mark').evaluate(path =>
    [[70, 110], [120, 110], [170, 110], [93, 110], [145, 110], [120, 46]].map(([x, y]) =>
      path.isPointInFill(new DOMPoint(x, y))));
  assert.deepEqual(marks, [true, true, true, false, false, false],
    'color tracing embosses both outer edges and the shared border, with clear interiors');
  assert.deepEqual(errors, []);
  console.log('PASS cookie cutter sample, PNG, inverted JPG, outline editor, handling lip, STL and 3MF parity, invalid-mesh block, threaded stamp and ring STLs, mating clearance, color-region embossing, and 3D previews');
} finally {
  await browser?.close();
  server.close();
  ledger.close();
}
