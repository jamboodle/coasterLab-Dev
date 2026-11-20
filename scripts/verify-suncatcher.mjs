import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withStatic} from '../server/static.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const {unzipSync, strFromU8} = require('../dist/vendor/fflate.js');
const server = createServer(withStatic((req, res) => res.writeHead(404).end(),
  fileURLToPath(new URL('../dist/', import.meta.url))));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;

function inspectSTL(bytes) {
  const data = Buffer.from(bytes);
  const triangles = data.readUInt32LE(80);
  assert.ok(triangles > 0);
  assert.equal(data.length, 84 + 50 * triangles);
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  const edges = new Map();
  for (let i = 0; i < triangles; i++) {
    const vertices = [0, 1, 2].map(corner => [0, 1, 2].map(axis => {
      const value = data.readFloatLE(96 + 50 * i + 12 * corner + 4 * axis);
      assert.ok(Number.isFinite(value));
      minimum[axis] = Math.min(minimum[axis], value);
      maximum[axis] = Math.max(maximum[axis], value);
      return value;
    }).join(','));
    assert.equal(new Set(vertices).size, 3);
    for (let edge = 0; edge < 3; edge++) {
      const a = vertices[edge], b = vertices[(edge + 1) % 3];
      const key = a < b ? a + '|' + b : b + '|' + a;
      const entry = edges.get(key) ?? {count: 0, direction: 0};
      entry.count++;
      entry.direction += a < b ? 1 : -1;
      edges.set(key, entry);
    }
  }
  assert.ok([...edges.values()].every(edge => edge.count === 2 && edge.direction === 0), 'STL is watertight');
  assert.equal(minimum[2], 0, 'flat on the print bed');
  return maximum.map((max, axis) => max - minimum[axis]);
}

function couponOpening(bytes, height) {
  const data = Buffer.from(bytes);
  const x = [], y = [];
  for (let triangle = 0; triangle < data.readUInt32LE(80); triangle++) {
    for (let corner = 0; corner < 3; corner++) {
      const offset = 96 + 50 * triangle + 12 * corner;
      const a = data.readFloatLE(offset), b = data.readFloatLE(offset + 4), z = data.readFloatLE(offset + 8);
      if (Math.abs(z - height) < 0.001 && a > 0 && a < 18 && b > 0 && b < 14) {
        x.push(a);
        y.push(b);
      }
    }
  }
  return [Math.max(...x) - Math.min(...x), Math.max(...y) - Math.min(...y)];
}

function near(actual, expected, tolerance = 0.05) {
  assert.ok(Math.abs(actual - expected) < tolerance, `Expected ${actual} within ${tolerance} of ${expected}`);
}

try {
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox']});
  const page = await browser.newPage({acceptDownloads: true});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('link', {name: 'Suncatcher Maker'}).click();
  await page.waitForURL(origin + '/suncatcher/');
  assert.match(await page.title(), /Suncatcher Maker/);
  async function ready() {
    try {
      await page.waitForFunction(() => !document.querySelector('#download').disabled &&
        document.querySelector('#part-summary').textContent.includes('Watertight frame'), null, {timeout: 20000});
    } catch (error) {
      throw Error('Model not ready: ' + await page.locator('#diagnostics').textContent() + ' / ' +
        await page.locator('#part-summary').textContent() + ' / ' + errors.join('; '), {cause: error});
    }
  }
  let downloads = 0;
  async function download(label) {
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', {name: label, exact: true}).click()]);
    const bytes = await readFile(await file.path());
    const output = process.env.SUNCATCHER_VERIFY_OUTPUT;
    if (output) {
      await mkdir(output, {recursive: true});
      const name = String(++downloads) + '-' + file.suggestedFilename();
      await writeFile(join(output, name), bytes);
    }
    return unzipSync(new Uint8Array(bytes));
  }

  await page.getByRole('button', {name: 'Try the flower sample'}).click();
  await ready();
  assert.match(await page.locator('#footprint').textContent(), /110\.0 × 117\.4 mm/);
  const first = await download('Download STL ZIP');
  assert.ok('assembly-map.png' in first);
  const flower = Object.keys(first).filter(name => /^insert-\d+\.stl$/.test(name));
  assert.ok(flower.length >= 6);
  for (const name of Object.keys(first).filter(name => name.endsWith('.stl'))) inspectSTL(first[name]);
  const flowerFrame = inspectSTL(first['suncatcher-frame.stl']);
  near(flowerFrame[0], 110);
  near(flowerFrame[1], 117.4);
  near(flowerFrame[2], 3);
  const fit = inspectSTL(first['fit-coupon-insert.stl']);
  near(fit[0], 11.6);
  near(fit[1], 7.6);
  near(fit[2], 1.8);
  const front = couponOpening(first['fit-coupon-frame.stl'], 0);
  const back = couponOpening(first['fit-coupon-frame.stl'], 3);
  near(front[0], 10.3);
  near(front[1], 6.3);
  near((back[0] - fit[0]) / 2, 0.2);
  near((back[1] - fit[1]) / 2, 0.2);
  assert.match(strFromU8(first['ASSEMBLY.txt']), /0\.2 mm per side/);
  const project = await download('Download 3MF');
  const model = strFromU8(project['3D/3dmodel.model']);
  assert.match(model, /unit="millimeter"/);
  assert.equal((model.match(/<item objectid=/g) || []).length, flower.length + 1);
  assert.match(model, /name="insert-\d+"/);

  const original = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 140;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 200, 140);
    context.fillStyle = '#111';
    context.fillRect(20, 20, 160, 100);
    context.clearRect(28, 28, 68, 84);
    context.clearRect(104, 28, 68, 84);
    return canvas.toDataURL().split(',')[1];
  });
  await page.locator('#artwork').setInputFiles({name: 'two-panes.png', mimeType: 'image/png', buffer: Buffer.from(original, 'base64')});
  await page.waitForFunction(() => document.querySelector('#artwork-status').textContent === 'two-panes.png');
  const trace = page.locator('#trace');
  const box = await trace.boundingBox();
  await trace.click({position: {x: box.width * 0.68, y: box.height * 0.5}});
  assert.equal(await page.locator('#region').inputValue(), '2');
  await page.getByLabel('Leave open').check();
  await page.locator('#region').selectOption('1');
  await page.locator('#color').fill('#33aa99');
  await page.getByLabel('Add hanging loop').uncheck();
  await page.locator('#size-axis').selectOption('height');
  await page.locator('#size').fill('60');
  await page.locator('#threshold').press('ArrowLeft');
  await page.locator('#smooth').press('ArrowRight');
  await ready();
  assert.match(await page.locator('#part-summary').textContent(), /1 validated insert/);
  const second = await download('Download STL ZIP');
  assert.ok('insert-01.stl' in second);
  assert.ok(!('insert-02.stl' in second));
  const uploadedFrame = inspectSTL(second['suncatcher-frame.stl']);
  near(uploadedFrame[1], 60);
  near(uploadedFrame[0], 96, 1);
  near(uploadedFrame[2], 3);
  assert.match(strFromU8(second['ASSEMBLY.txt']), /Insert 01: #33aa99/i);

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="95" viewBox="0 0 120 95"><path d="M10 10H110V85H10Z" fill="none" stroke="black" stroke-width="6"/></svg>';
  await page.locator('#artwork').setInputFiles({name: 'rectangle.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg)});
  await page.waitForFunction(() => document.querySelector('#artwork-status').textContent === 'rectangle.svg');
  await ready();
  assert.match(await page.locator('#part-summary').textContent(), /1 validated insert/);
  const coupon = await download('Download fit coupon');
  assert.deepEqual(Object.keys(coupon).sort(), ['ASSEMBLY.txt', 'fit-coupon-frame.stl', 'fit-coupon-insert.stl']);
  const detached = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><path d="M10 10H105V85H10Z M125 25H140" fill="none" stroke="black" stroke-width="5"/></svg>';
  await page.locator('#artwork').setInputFiles({name: 'detached.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(detached)});
  await page.waitForFunction(() => document.querySelector('#diagnostics').textContent.includes('2 disconnected sections'));
  assert.equal(await page.getByRole('button', {name: 'Download STL ZIP'}).isDisabled(), true);

  const tiny = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140"><path fill="black" fill-rule="evenodd" d="M20 20H180V120H20Z M30 30H145V110H30Z M160 68H163V71H160Z"/></svg>';
  await page.locator('#artwork').setInputFiles({name: 'tiny.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(tiny)});
  await page.locator('#size').fill('25');
  await ready();
  assert.match(await page.locator('#diagnostics').textContent(), /too small/);
  assert.match(await page.locator('#part-summary').textContent(), /1 validated insert/);

  const gapped = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140"><path d="M97 20H20V120H180V20H104" fill="none" stroke="black" stroke-width="5"/></svg>';
  await page.locator('#artwork').setInputFiles({name: 'gapped.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(gapped)});
  await page.waitForFunction(() => document.querySelector('#diagnostics').textContent.includes('No closed regions'));
  assert.equal(await page.getByRole('button', {name: 'Download STL ZIP'}).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('PASS sample, uploaded PNG and SVG, region edit, watertight dimensioned STL ZIP, fit coupon, and separate-object 3MF');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
