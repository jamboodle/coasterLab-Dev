import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {handler} from '../server/app.mjs';
import {artworkLibrary} from '../server/artwork.mjs';
import {Ledger} from '../server/ledger.mjs';
import {withStatic} from '../server/static.mjs';

const {chromium, devices} = createRequire(import.meta.url)('playwright');
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const dataDir = await mkdtemp(join(tmpdir(), 'coaster-artwork-browser-'));
const ledger = new Ledger(':memory:');
const id = ledger.registerIdentity('artwork-admin@example.com', 'salt', 'digest');
ledger.makeAdmin('artwork-admin@example.com');
const session = ledger.createSession(id);
const artwork = artworkLibrary({
  dataDir, key: 'fixture-key',
  fetchImpl: async () => Response.json({choices: [{message: {content: '{"tags":["woodland","gold"]}'}}]})
});
let origin;
const server = createServer(withStatic((req, res) => handler({ledger, origin, artwork})(req, res), dist));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox']});
  const setup = await browser.newContext();
  const page = await setup.newPage();
  const {png: pngUrl, webp: webpUrl} = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffcc66';
    context.fillRect(0, 0, 120, 80);
    context.fillStyle = '#222222';
    context.fillRect(35, 20, 50, 40);
    return {png: canvas.toDataURL('image/png'), webp: canvas.toDataURL('image/webp')};
  });
  const category = join(dataDir, 'artwork', 'Animals');
  await mkdir(category, {recursive: true});
  await writeFile(join(category, 'Fox.png'), Buffer.from(pngUrl.split(',')[1], 'base64'));
  assert.ok(webpUrl.startsWith('data:image/webp;'));
  await writeFile(join(category, 'WebP listed as PNG.png'), Buffer.from(webpUrl.split(',')[1], 'base64'));
  await setup.addCookies([{name: 'cl_session', value: session, url: origin}]);
  await page.goto(origin + '/admin/');
  await page.getByRole('tab', {name: 'Artwork'}).click();
  await page.getByRole('button', {name: 'Reindex'}).click();
  await page.waitForFunction(() => document.querySelector('#artwork-status').textContent.includes('2 with tags.'));
  await setup.close();

  const errors = [];
  async function openLibrary(maker) {
    const [popup] = await Promise.all([
      maker.waitForEvent('popup'),
      maker.getByRole('link', {name: 'Try one of our designs'}).click()
    ]);
    popup.on('pageerror', error => errors.push(error.message));
    await popup.getByRole('button', {name: 'Fox', exact: true}).waitFor();
    return popup;
  }

  const desktop = await browser.newContext();
  const maker = await desktop.newPage();
  maker.on('pageerror', error => errors.push(error.message));
  await maker.goto(origin);
  const popup = await openLibrary(maker);
  await popup.getByLabel('Search artwork').fill('unmatched');
  assert.equal(await popup.locator('.tile').count(), 0);
  await popup.getByLabel('Search artwork').fill('woodland gold');
  await popup.getByLabel('Category').selectOption('Animals');
  await popup.getByRole('button', {name: 'Fox', exact: true}).click();
  const canvas = popup.locator('#preview');
  await canvas.waitFor();
  const pixel = (x, y) => canvas.evaluate((element, [x, y]) =>
    Array.from(element.getContext('2d').getImageData(x, y, 1, 1).data), [x, y]);
  await popup.getByRole('button', {name: 'Fill', exact: true}).click();
  await canvas.click({position: {x: 5, y: 5}});
  assert.deepEqual(await pixel(5, 5), [34, 34, 34, 255]);
  await popup.getByRole('button', {name: 'Undo', exact: true}).click();
  assert.deepEqual(await pixel(5, 5), [255, 204, 102, 255]);
  await popup.getByRole('button', {name: 'Redo', exact: true}).click();
  assert.deepEqual(await pixel(5, 5), [34, 34, 34, 255]);
  await popup.getByRole('button', {name: 'Erase', exact: true}).click();
  await canvas.click({position: {x: 60, y: 40}});
  assert.equal((await pixel(60, 40))[3], 0);
  await popup.getByLabel('Color', {exact: true}).fill('#ff0000');
  await popup.getByRole('button', {name: 'Paint', exact: true}).click();
  await canvas.click({position: {x: 60, y: 40}});
  assert.deepEqual(await pixel(60, 40), [255, 0, 0, 255]);
  await popup.getByRole('button', {name: 'Rotate 90°'}).click();
  assert.equal(await canvas.evaluate(element => element.width), 80);
  await popup.getByRole('button', {name: 'Flip horizontal'}).click();
  await popup.getByRole('button', {name: 'Flip vertical'}).click();
  await popup.getByText('Text blocks', {exact: true}).click();
  const addText = popup.getByRole('button', {name: 'Add text block'});
  for (let i = 1; i <= 3; i++) {
    await addText.click();
    await popup.getByLabel('Text block ' + i, {exact: true}).fill('Label ' + i);
  }
  assert.equal(await addText.isDisabled(), true);
  await Promise.all([
    popup.waitForEvent('close'),
    popup.getByRole('button', {name: 'Build my coaster'}).click()
  ]);
  await maker.locator('#queue img[alt="Fox.png"]').waitFor();
  await maker.waitForFunction(() => document.querySelector('#queue img').naturalWidth === 80);
  assert.ok(await maker.locator('#trace').isEnabled());

  const retry = await openLibrary(maker);
  await retry.getByRole('button', {name: 'Fox', exact: true}).click();
  await retry.getByRole('button', {name: 'Build my coaster'}).click();
  await retry.waitForFunction(() => document.querySelector('#feedback').textContent.includes('Only 1 image'));
  assert.equal(await maker.locator('#queue img').count(), 1);
  await retry.close();
  await desktop.close();

  const mobile = await browser.newContext(devices['Pixel 7']);
  const phoneMaker = await mobile.newPage();
  await phoneMaker.goto(origin);
  const phoneLibrary = await openLibrary(phoneMaker);
  await Promise.all([
    phoneLibrary.waitForEvent('close'),
    phoneLibrary.getByRole('button', {name: 'Fox', exact: true}).tap()
  ]);
  await phoneMaker.locator('#queue img[alt="Fox.png"]').waitFor();
  const received = await phoneMaker.locator('#queue img').evaluate(async img => {
    const original = await (await fetch(img.src)).blob();
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(original);
    });
  });
  assert.equal(received, pngUrl);
  await phoneMaker.locator('#clear').click();
  const webpLibrary = await openLibrary(phoneMaker);
  await Promise.all([
    webpLibrary.waitForEvent('close'),
    webpLibrary.getByRole('button', {name: 'WebP listed as PNG', exact: true}).tap()
  ]);
  const imported = phoneMaker.locator('#queue img[alt="WebP listed as PNG.png"]');
  await imported.waitFor();
  const converted = await imported.evaluate(async img => {
    await img.decode();
    const blob = await (await fetch(img.src)).blob();
    return [blob.type, img.naturalWidth, img.naturalHeight,
      Array.from(new Uint8Array(await blob.slice(0, 8).arrayBuffer()))];
  });
  assert.deepEqual(converted, ['image/png', 120, 80, [137, 80, 78, 71, 13, 10, 26, 10]]);
  assert.deepEqual(errors, []);
  console.log('PASS artwork reindex, search, desktop editor, maker import limit, and unedited mobile handoff');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  ledger.close();
  await rm(dataDir, {recursive: true, force: true});
}
