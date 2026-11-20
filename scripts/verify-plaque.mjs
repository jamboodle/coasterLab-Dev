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
try {
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox']});
  const page = await browser.newPage({acceptDownloads: true});
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(origin);
  await page.getByRole('link', {name: 'Plaque Maker', exact: true}).click();
  await page.waitForURL(origin + '/plaque/');
  await page.getByRole('button', {name: 'Try the sample'}).click();
  await page.waitForFunction(() => document.querySelectorAll('.tier').length === 3);
  const heights = page.locator('[data-field=top]');
  await heights.nth(1).fill('2');
  await page.getByRole('button', {name: 'Build plaque'}).click();
  await page.waitForFunction(() => document.querySelector('#model-status').textContent.includes('Use distinct top heights'));
  await heights.nth(1).fill('5');
  await heights.nth(2).fill('7.5');
  const build = page.getByRole('button', {name: 'Build plaque'});
  const project = page.getByRole('button', {name: 'Download 3MF'});
  async function buildPlaque() {
    await build.click();
    try {
      await page.waitForFunction(() => !document.querySelector('#project').disabled, null, {timeout: 20000});
    } catch (error) {
      throw Error(await page.locator('#model-status').textContent(), {cause: error});
    }
  }
  await buildPlaque();
  assert.match(await page.locator('#model-status').textContent(), /3 watertight tiers · 220 × [\d.]+ × 7\.5 mm/);
  const rendered = await page.locator('#model').evaluate(canvas =>
    canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0));
  assert.equal(rendered, true);
  await page.locator('#width').fill('170');
  assert.equal(await project.isDisabled(), true);
  await buildPlaque();

  const upload = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 420;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffff00';
    context.fillRect(0, 0, 420, 420);
    context.fillStyle = '#428c12';
    context.fillRect(20, 20, 380, 380);
    for (const [i, hex] of ['#e51523', '#ec09a8', '#163cde', '#ffffff'].entries()) {
      context.fillStyle = hex;
      context.beginPath();
      context.ellipse(100 + (i % 2) * 200, 100 + Math.floor(i / 2) * 200, 49, 62, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = '#163cde';
    context.fillRect(4, 4, 7, 7);
    return canvas.toDataURL().split(',')[1];
  });
  await page.locator('#color-count').fill('6');
  assert.equal(await page.locator('#background').isChecked(), false);
  const files = await page.evaluateHandle(encoded => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    transfer.items.add(new File([bytes], 'border-and-specks.png', {type: 'image/png'}));
    return transfer;
  }, upload);
  await page.locator('#drop').dispatchEvent('drop', {dataTransfer: files});
  await page.waitForFunction(() => document.querySelectorAll('.tier').length === 6);
  assert.equal(await page.locator('.tier').first().getAttribute('data-source'), '#ffff00');
  await page.locator('#width').fill('220');
  await buildPlaque();
  assert.match(await page.locator('#model-status').textContent(), /6 watertight tiers/);
  assert.match(await page.locator('#model-status').textContent(), /detached raised detail/);
  const [borderStls] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', {name: 'Download STL tiers'}).click()
  ]);
  const borderZip = unzipSync(new Uint8Array(await readFile(await borderStls.path())));
  assert.match(strFromU8(borderZip['FILAMENT-HEIGHTS.txt']), /tier-01: artwork #ffff00/);
  const raised = Buffer.from(borderZip['tier-02.stl']);
  for (let triangle = 0; triangle < raised.readUInt32LE(80); triangle++) {
    for (let corner = 0; corner < 3; corner++) {
      const offset = 96 + 50 * triangle + 12 * corner;
      assert.ok(raised.readFloatLE(offset) > 8 && raised.readFloatLE(offset + 4) < 213, 'detached corner speck is absent');
    }
  }
  if (process.env.PLAQUE_VERIFY_OUTPUT) {
    const [borderProject] = await Promise.all([page.waitForEvent('download'), project.click()]);
    const output = process.env.PLAQUE_VERIFY_OUTPUT;
    await mkdir(output, {recursive: true});
    await writeFile(join(output, 'border-plaque.3mf'), await readFile(await borderProject.path()));
  }
  await page.locator('#background').check();
  await page.locator('#color-count').fill('5');
  await page.getByRole('button', {name: 'Trace artwork', exact: true}).click();
  await page.waitForFunction(() => document.querySelectorAll('.tier').length === 5);
  assert.equal(await page.locator('.tier[data-source="#ffff00"]').count(), 0, 'yellow edge background removed');
  const colors = page.locator('[data-field=color]');
  await colors.nth(2).fill('#dc83bd');
  await colors.nth(4).fill('#dc83bd');
  await page.locator('#width').fill('220');
  await buildPlaque();
  assert.match(await page.locator('#model-status').textContent(), /5 watertight tiers · 220 × 220 × 10 mm/);

  let downloadCount = 0;
  async function getArchive(button) {
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
    const bytes = await readFile(await download.path());
    const output = process.env.PLAQUE_VERIFY_OUTPUT;
    if (output) {
      await mkdir(output, {recursive: true});
      await writeFile(join(output, ++downloadCount + '-' + download.suggestedFilename()), bytes);
    }
    return unzipSync(new Uint8Array(bytes));
  }
  const output = await getArchive(project);
  const xml = strFromU8(output['3D/3dmodel.model']);
  assert.match(xml, /unit="millimeter"/);
  const placement = /<item objectid="100" transform="([^"]+)"/.exec(xml)?.[1].split(' ').map(Number);
  assert.ok(placement && Math.abs(placement[9] - 24) < 0.01 && Math.abs(placement[10] - 18) < 0.01);
  assert.equal((xml.match(/<item objectid=/g) || []).length, 1);
  assert.equal((xml.match(/<component objectid=/g) || []).length, 5);
  assert.equal((xml.match(/displaycolor=/g) || []).length, 4);
  const projectSettings = JSON.parse(strFromU8(output['Metadata/project_settings.config']));
  assert.equal(projectSettings.printer_model, 'Bambu Lab P1S');
  assert.equal(projectSettings.enable_prime_tower, '0');
  assert.equal(projectSettings.filament_colour.length, 4);
  const partSettings = strFromU8(output['Metadata/model_settings.config']);
  assert.equal((partSettings.match(/key="extruder" value="3"/g) || []).length, 2);
  assert.match(strFromU8(output['Metadata/FILAMENT-HEIGHTS.txt']), /tier-05: artwork .* filament #dc83bd, Z 8–10 mm/);
  const stls = await getArchive(page.getByRole('button', {name: 'Download STL tiers'}));
  for (let i = 1; i <= 5; i++) {
    const bytes = Buffer.from(stls['tier-0' + i + '.stl']);
    const triangles = bytes.readUInt32LE(80);
    assert.ok(triangles > 0);
    const heights = new Set();
    for (let triangle = 0; triangle < triangles; triangle++) {
      for (let corner = 0; corner < 3; corner++) heights.add(bytes.readFloatLE(104 + 50 * triangle + 12 * corner));
    }
    assert.deepEqual([...heights].sort((a, b) => a - b), [(i - 1) * 2, i * 2]);
  }
  await page.locator('#mode').selectOption('bw');
  await page.getByText('Advanced tracing', {exact: true}).click();
  assert.equal(await page.locator('#threshold').isVisible(), true);
  await page.locator('#threshold').press('ArrowRight');
  await page.locator('#pinhole').selectOption('25');
  await page.locator('#smooth-outer').uncheck();
  assert.equal(await page.locator('#edge-strength').isDisabled(), true);
  await page.getByRole('button', {name: 'Trace artwork', exact: true}).click();
  await page.waitForFunction(() => document.querySelectorAll('.tier').length === 1);
  await page.locator('#mode').selectOption('color');
  await page.locator('#smooth-outer').check();
  if (process.env.PLAQUE_VERIFY_INPUT) {
    await page.locator('#color-count').fill('4');
    await page.locator('#detail').selectOption('smooth');
    await page.locator('#file').setInputFiles(process.env.PLAQUE_VERIFY_INPUT);
    await page.waitForFunction(() => document.querySelectorAll('.tier').length === 4);
    await buildPlaque();
    assert.match(await page.locator('#model-status').textContent(), /4 watertight tiers/);
    await getArchive(project);
  }
  assert.deepEqual(failures, []);
  console.log('PASS plaque upload and drop, preserved border, cleaned raised specks, coaster trace controls, and printable STL/3MF exports');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
