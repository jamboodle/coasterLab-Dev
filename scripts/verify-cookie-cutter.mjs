import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withStatic} from '../server/static.mjs';

const {chromium} = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const server = createServer(withStatic((req, res) => res.writeHead(404).end(), root));
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
    assert.deepEqual([...heights].sort((a, b) => a - b), [0, 3, Math.fround(expected.depth)]);
    const relief = [...vertices.values()].filter(point => point[2] > 3);
    assert.ok(relief.length > 3, 'raised stamp detail is present');
    if (expected.markOnRight) {
      const width = Math.max(...[...vertices.values()].map(point => point[0]));
      assert.ok(relief.every(point => point[0] > width / 2), 'left-side artwork is mirrored on the stamp');
    }
    return;
  }
  assert.deepEqual([...heights].sort((a, b) => a - b), [0, expected.depth], 'straight-sided cutter has no height steps');
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
  }
  await page.locator('#sample').click();
  await page.waitForFunction(() => document.querySelector('#trace-status').textContent.includes('1 detected shape'));
  await build('sample-star', {axis: 'width', size: 80});
  async function checkStamp(name) {
    assert.equal(await page.locator('#download-stamp').isEnabled(), true, await page.locator('#stamp-status').textContent());
    await page.locator('#view-stamp').click();
    assert.equal(await page.locator('#viewer').getAttribute('aria-label'), 'Rotatable stamp preview');
    assert.equal(await page.locator('#overlay .stamp-mark').count(), 1);
    const [file] = await Promise.all([page.waitForEvent('download'), page.locator('#download-stamp').click()]);
    assert.equal(file.suggestedFilename(), 'coasterprint-cookie-stamp.stl');
    const bytes = await readFile(await file.path());
    inspect(bytes, {stamp: true, depth: 4.4, markOnRight: name === 'transparent-circle-stamp'});
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
  assert.deepEqual(errors, []);
  console.log('PASS cookie cutter sample, PNG, inverted JPG, outline editor, straight wall, invalid-mesh block, separate stamp STL and 3D previews');
} finally {
  await browser?.close();
  server.close();
}
