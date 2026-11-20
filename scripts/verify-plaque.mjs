import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withStatic} from '../server/static.mjs';
import {handler} from '../server/app.mjs';
import {Ledger} from '../server/ledger.mjs';
import {modelPayload} from '../tests/export-fixture.mjs';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const {unzipSync, strFromU8} = require('../dist/vendor/fflate.js');
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'asset-manifest.json'), 'utf8'));
const ledger = new Ledger(':memory:');
const account = ledger.registerIdentity('plaque@example.com', 'salt', 'digest');
ledger.saveSettings(account, {billingEnabled: true});
const session = ledger.createSession(account);
const serve = withStatic((req, res) => handler({ledger, origin, customerAccounts: true})(req, res), root);
const server = createServer((req, res) => {
  if (req.url === '/plaque/test-mesh.js') {
    const source = '/' + manifest.scripts['stl-geometry.js'];
    res.writeHead(200, {'Content-Type': 'text/javascript'});
    return res.end(`export {pathContours, signedArea} from '${source}';
      import {binarySTL as validate} from '${source}';
      let first = true;
      export function binarySTL(solid, name) {
        if (first) { first = false; throw Error('An export triangle has zero area.'); }
        return validate(solid, name);
      }`);
  }
  return serve(req, res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--enable-unsafe-swiftshader']});
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
  await heights.nth(0).fill('7.5');
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
  await project.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText(/Log in or create an account to download 3MF/).waitFor();
  const [anonymousSTL] = await Promise.all([
    page.waitForEvent('download'), dialog.getByRole('button', {name: 'Switch to free STL'}).click()
  ]);
  assert.equal(anonymousSTL.suggestedFilename(), 'coasterprint-plaque-stls.zip');
  assert.equal(ledger.balance(account), 15);
  await page.context().addCookies([{name: 'cl_session', value: session, url: origin}]);

  async function getProject(expectedCost) {
    const startingBalance = ledger.balance(account);
    await project.click();
    const confirm = dialog.getByRole('button', {name: expectedCost ? /Confirm · 1 credit/ : 'Prepare free download'});
    await confirm.waitFor();
    assert.match(await dialog.locator('[data-summary]').textContent(), /1 plaque/);
    assert.equal(ledger.balance(account), startingBalance);
    await confirm.click();
    const [file] = await Promise.all([
      page.waitForEvent('download'), dialog.getByRole('button', {name: 'Download Ready'}).click()
    ]);
    assert.equal(file.suggestedFilename(), 'coasterprint-plaque.3mf');
    assert.equal(ledger.balance(account), startingBalance - expectedCost);
    await dialog.getByRole('button', {name: 'Close export confirmation'}).click();
    return file;
  }

  const stack = page.locator('.tier');
  const order = () => stack.evaluateAll(rows => rows.map(row => row.dataset.source));
  const values = () => heights.evaluateAll(inputs => inputs.map(input => input.valueAsNumber));
  assert.deepEqual(await values(), [7.5, 5, 2]);
  const colorsBefore = await order();
  const colorInput = stack.first().locator('[data-field=color]');
  await colorInput.fill('#a42b70');
  await stack.first().locator('.tier-grip').dragTo(stack.last());
  assert.deepEqual(await order(), [colorsBefore[1], colorsBefore[2], colorsBefore[0]]);
  assert.deepEqual(await values(), [7.5, 5, 2]);
  assert.equal(await stack.last().locator('[data-field=color]').inputValue(), '#a42b70');
  assert.equal(await project.isDisabled(), true);
  await page.getByRole('button', {name: 'Sort by traced area'}).click();
  assert.deepEqual(await order(), colorsBefore);
  assert.deepEqual(await values(), [7.5, 5, 2]);
  assert.equal(await stack.first().locator('[data-field=color]').inputValue(), '#a42b70');
  await stack.first().locator('.tier-grip').dragTo(stack.last());
  const up = page.getByRole('button', {name: 'Move ' + colorsBefore[0] + ' higher'});
  await up.press('Enter');
  await up.press('Enter');
  assert.deepEqual(await order(), colorsBefore);
  assert.deepEqual(await values(), [7.5, 5, 2]);
  assert.match(await page.locator('#tier-status').textContent(), /7\.5 mm/);
  const traceStyle = await page.locator('#trace-artwork').evaluate(button => getComputedStyle(button).backgroundColor);
  const sampleStyle = await page.locator('#sample').evaluate(button => getComputedStyle(button).backgroundColor);
  assert.equal(traceStyle, 'rgb(249, 224, 100)');
  assert.equal(sampleStyle, 'rgb(141, 226, 198)');
  await buildPlaque();
  const viewer = page.locator('#viewer');
  await viewer.waitFor({state: 'visible'});
  const initial = await viewer.screenshot();
  const box = await viewer.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 40, {steps: 6});
  await page.mouse.up();
  const rotated = await viewer.screenshot();
  assert.equal(initial.equals(rotated), false);
  await page.getByRole('button', {name: 'Zoom in'}).click();
  const zoomed = await viewer.screenshot();
  assert.equal(rotated.equals(zoomed), false);
  await page.getByRole('button', {name: 'Reset view'}).click();
  const reset = await viewer.screenshot();
  assert.equal(zoomed.equals(reset), false);
  await viewer.press('ArrowUp');
  assert.equal(reset.equals(await viewer.screenshot()), false);
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
  assert.equal(await page.locator('.tier').first().getAttribute('data-source'), '#428c12');
  const areas = await page.locator('.tier-area').evaluateAll(labels => labels.map(label =>
    Number(label.textContent.match(/\d+(?:\.\d+)?/)[0])));
  assert.deepEqual(areas, [...areas].sort((a, b) => b - a));
  assert.ok(areas[0] > 50);
  await page.locator('.tier[data-source="#ffff00"] .tier-grip').dragTo(page.locator('.tier').last());
  assert.equal(await page.locator('.tier').last().getAttribute('data-source'), '#ffff00');
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
    const borderProject = await getProject(1);
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
  await colors.nth(0).fill('#dc83bd');
  await page.locator('#width').fill('220');
  await buildPlaque();
  assert.match(await page.locator('#model-status').textContent(), /5 watertight tiers · 220 × 220 × 10 mm/);

  let downloadCount = 0;
  async function readArchive(download) {
    const bytes = await readFile(await download.path());
    const output = process.env.PLAQUE_VERIFY_OUTPUT;
    if (output) {
      await mkdir(output, {recursive: true});
      await writeFile(join(output, ++downloadCount + '-' + download.suggestedFilename()), bytes);
    }
    return unzipSync(new Uint8Array(bytes));
  }
  const output = await readArchive(await getProject(1));
  await readArchive(await getProject(0));
  const balanceBeforeCoaster = ledger.balance(account);
  const response = await page.request.post(origin + '/api/exports', {data: modelPayload(), headers: {Origin: origin}});
  assert.equal(response.status(), 201);
  const quote = await response.json();
  assert.equal(quote.balance, balanceBeforeCoaster);
  const authorized = await page.request.post(origin + '/api/exports/' + quote.id + '/authorize', {
    data: {expectedCost: 1}, headers: {Origin: origin}
  });
  assert.equal(authorized.status(), 200);
  assert.equal(ledger.balance(account), balanceBeforeCoaster - 1);
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
  const beforeSTL = ledger.balance(account);
  const [stlFile] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', {name: 'Download STL tiers'}).click()
  ]);
  const stls = await readArchive(stlFile);
  assert.equal(ledger.balance(account), beforeSTL);
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
    await readArchive(await getProject(1));
  }
  const recovery = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker('/plaque/geometry-worker.js', {type: 'module'});
    worker.onmessage = ({data}) => {
      worker.terminate();
      if (data.error) reject(Error(data.error));
      else resolve({repair: data.result.repair, tiers: data.result.parts.length});
    };
    worker.onerror = () => reject(Error('The test geometry worker failed.'));
    worker.postMessage({
      geometryScript: 'plaque/test-mesh.js', viewWidth: 100, width: 100, largest: true, cleanRelief: true,
      paths: [{color: '#ffff00', d: 'M0 0L40 0L40.004 0.0004L70 0L100 0L100 100L0 100Z'},
        {color: '#008000', d: 'M10 10L90 10L90 90L10 90Z'}],
      tiers: [{source: '#ffff00', color: '#ffff00', top: 2},
        {source: '#008000', color: '#008000', top: 4}]
    });
  }));
  assert.ok(recovery.repair > 0 && recovery.tiers === 2, 'base-tier validation failure retries with contour repair');
  assert.deepEqual(failures, []);
  console.log('PASS plaque tier drag, automatic heights, keyboard ordering, orbit controls, and STL/3MF exports');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  ledger.close();
}
