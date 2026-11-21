import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
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
let resolveTags;
const holdTags = new Promise(resolve => { resolveTags = resolve; });
let tagRequests = 0;
const artwork = artworkLibrary({
  dataDir, key: 'fixture-key',
  fetchImpl: async () => {
    if (++tagRequests === 2) await holdTags;
    return Response.json({choices: [{message: {content: '{"tags":["woodland","gold"]}'}}]});
  }
});
const resourceRoot = join(dataDir, 'resource-images');
const resourceFolder = join(resourceRoot, 'Animals', 'Woodland');
let resourceRequests = 0;
const resources = artworkLibrary({dataDir, resourceRoot, key: 'fixture-key', fetchImpl: async (url, options) => {
  resourceRequests++;
  for (const file of ['Hidden Format.png', 'Renamed.png']) {
    assert.equal((await readFile(join(resourceFolder, file))).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  assert.match(JSON.parse(options.body).messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  return Response.json({choices: [{message: {content: '{"tags":["amber fox"]}'}}]});
}});
let origin;
const server = createServer(withStatic((req, res) => handler({ledger, origin, artwork, resources})(req, res), dist));
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
  await page.waitForFunction(() => {
    const bar = document.querySelector('#artwork-progress');
    return !bar.hidden && bar.max === 2 && bar.value === 1;
  });
  assert.match(await page.locator('#artwork-status').textContent(), /Processed 1 of 2 artwork files/);
  assert.equal(await page.getByRole('button', {name: 'Reindex'}).isDisabled(), true);
  await page.reload();
  await page.getByRole('tab', {name: 'Artwork'}).click();
  await page.waitForFunction(() => document.querySelector('#artwork-progress').position === 0.5);
  resolveTags();
  await page.waitForFunction(() => document.querySelector('#artwork-status').textContent.includes('2 with tags.'));
  assert.equal(await page.locator('#artwork-progress').isHidden(), true);
  assert.equal(await page.getByRole('button', {name: 'Reindex'}).isEnabled(), true);
  await mkdir(resourceFolder, {recursive: true});
  const resourceWebp = Buffer.from(webpUrl.split(',')[1], 'base64');
  await writeFile(join(resourceFolder, 'Hidden Format.png'), resourceWebp);
  await writeFile(join(resourceFolder, 'Renamed.webp'), resourceWebp);
  await writeFile(join(resourceFolder, 'Corrupt.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  await page.getByRole('tab', {name: 'Resources', exact: true}).click();
  await page.getByRole('button', {name: 'Validate, convert and reindex'}).click();
  const result = page.locator('#resources-status');
  await result.getByText(/2 WebP files converted to PNG/).waitFor();
  assert.match(await result.textContent(), /2 with tags/);
  assert.match(await result.textContent(), /Corrupt.png/);
  await assert.rejects(readFile(join(resourceFolder, 'Renamed.webp')), {code: 'ENOENT'});
  assert.equal(resourceRequests, 1, 'identical resources share a tag request');
  await page.getByRole('button', {name: 'Validate, convert and reindex'}).click();
  await page.getByRole('button', {name: 'Validate, convert and reindex'}).waitFor({state: 'visible'});
  await page.waitForFunction(() => !document.querySelector('#reindex-resources').disabled);
  assert.equal(resourceRequests, 1, 'tags are reused on reindex');

  const guest = await browser.newPage({acceptDownloads: true});
  await guest.goto(origin);
  await guest.getByRole('link', {name: 'Resources', exact: true}).click();
  await guest.getByRole('searchbox').fill('amber fox');
  await guest.getByLabel('Category').selectOption('Animals / Woodland');
  await guest.getByRole('button', {name: 'Hidden Format'}).click();
  const preview = guest.getByRole('dialog');
  await preview.getByRole('img', {name: 'Hidden Format'}).waitFor();
  await preview.getByRole('button', {name: 'Open in editor'}).click();
  await guest.getByRole('button', {name: 'Rotate 90°'}).click();
  const [download] = await Promise.all([
    guest.waitForEvent('download'), guest.getByRole('button', {name: 'Download edited PNG'}).click()
  ]);
  assert.equal(download.suggestedFilename(), 'Hidden Format.png');
  const edited = await readFile(await download.path());
  assert.equal(edited.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(edited.readUInt32BE(16), 80);
  assert.equal(edited.readUInt32BE(20), 120);
  await guest.close();
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
  const ink = popup.getByLabel('Image color', {exact: true});
  assert.deepEqual(await ink.locator('option').evaluateAll(options => options.map(option => option.value)), ['#ffcc66', '#222222']);
  await ink.selectOption('#ffcc66');
  await popup.getByRole('button', {name: 'Paint', exact: true}).click();
  await canvas.click({position: {x: 60, y: 40}});
  assert.deepEqual(await pixel(60, 40), [255, 204, 102, 255]);
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
  await popup.getByLabel('Text block 3', {exact: true}).press('Tab');
  assert.equal(await addText.isDisabled(), true);
  const textColor = popup.getByLabel('Color for text block 1', {exact: true});
  assert.deepEqual(await textColor.locator('option').evaluateAll(options => options.map(option => option.value)), ['#ffcc66', '#222222']);
  const snapshot = () => canvas.evaluate(element => element.toDataURL());
  const straight = await snapshot();
  const font = popup.getByLabel('Font for text block 1', {exact: true});
  await font.selectOption({label: 'Courier New'});
  const monospace = await snapshot();
  assert.notEqual(monospace, straight);
  const layout = popup.getByLabel('Layout for text block 1', {exact: true});
  const curve = popup.getByLabel('Curve for text block 1', {exact: true});
  assert.equal(await curve.isHidden(), true);
  await layout.selectOption('arc');
  assert.equal(await curve.isVisible(), true);
  const arc = await snapshot();
  assert.notEqual(arc, monospace);
  await layout.selectOption('wave');
  const wave = await snapshot();
  assert.notEqual(wave, arc);
  assert.notEqual(wave, monospace);
  await popup.getByRole('button', {name: 'Undo', exact: true}).click();
  assert.equal(await layout.inputValue(), 'arc');
  assert.equal(await snapshot(), arc);
  await popup.getByRole('button', {name: 'Redo', exact: true}).click();
  assert.equal(await layout.inputValue(), 'wave');
  assert.equal(await snapshot(), wave);
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
  console.log('PASS Resources validation, conversion, cached tags, preview and edited PNG download; artwork reindex, search, desktop editor, maker import limit, and unedited mobile handoff');
} finally {
  resolveTags();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  ledger.close();
  await rm(dataDir, {recursive: true, force: true});
}
