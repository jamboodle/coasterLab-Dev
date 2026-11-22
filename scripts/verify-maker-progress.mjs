import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {handler} from '../server/app.mjs';
import {Ledger} from '../server/ledger.mjs';
import {withStatic} from '../server/static.mjs';
import {fileURLToPath} from 'node:url';

const {chromium, devices} = createRequire(import.meta.url)('playwright');
const ledger = new Ledger(':memory:');
let origin, browser;
const server = createServer(withStatic((req, res) => handler({ledger, origin})(req, res), fileURLToPath(new URL('../dist/', import.meta.url))));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = 'http://127.0.0.1:' + server.address().port;

async function interrupt(page, workerURL, trigger, status) {
  await page.route(workerURL, route => route.fulfill({
    contentType: 'application/javascript',
    body: "self.onmessage = () => postMessage({progress: 'Checking the test geometry…'});"
  }));
  await trigger.click();
  const activity = page.locator('.build-feedback');
  await activity.getByText('Checking the test geometry…', {exact: true}).waitFor();
  await activity.getByText(/elapsed/).waitFor();
  assert.equal(await activity.evaluate(node => getComputedStyle(node).position), 'fixed');
  const cancel = activity.getByRole('button', {name: 'Cancel build'});
  assert.ok((await cancel.boundingBox()).height >= 44);
  await cancel.tap();
  await activity.waitFor({state: 'detached'});
  assert.match(await page.locator(status).textContent(), /Build cancelled/);
  assert.equal(await trigger.isEnabled(), true);
  await page.unroute(workerURL);
}

try {
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']});
  const context = await browser.newContext(devices['iPhone 13']);
  const coaster = await context.newPage();
  await coaster.goto(origin);
  const png = await coaster.evaluate(() => {
    const canvas = Object.assign(document.createElement('canvas'), {width: 100, height: 100});
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = '#132369'; ctx.fillRect(20, 25, 60, 50);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await coaster.locator('#files').setInputFiles({name: 'progress-test.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')});
  const trace = coaster.locator('#trace');
  await interrupt(coaster, /\/stl-worker\.[a-f0-9]+\.js$/, trace, '#notice');
  assert.equal(await coaster.locator('#queue .card').count(), 1);
  await trace.click();
  await coaster.locator('#go-download').waitFor({state: 'visible'});

  const plaque = await context.newPage();
  await plaque.goto(origin + '/plaque/');
  await plaque.locator('#sample').click();
  await plaque.locator('#next-build').waitFor();
  const plaqueBuild = plaque.locator('#build');
  await interrupt(plaque, '**/plaque/geometry-worker.js', plaqueBuild, '#model-status');
  assert.ok(await plaque.locator('#tiers input').count() > 0);
  await plaqueBuild.click();
  await plaque.locator('#next-preview').waitFor();

  const cookie = await context.newPage();
  await cookie.goto(origin + '/cookie-cutter/');
  await cookie.locator('#sample').click();
  await cookie.locator('#next-build').waitFor();
  const cookieBuild = cookie.locator('#build');
  await interrupt(cookie, '**/cookie-cutter/stamp-trace-worker.js', cookieBuild, '#model-status');
  assert.equal(await cookie.locator('#outline-tools').isVisible(), true);
  await cookieBuild.click();
  await cookie.locator('#next-preview').waitFor();
  assert.equal(await cookie.locator('#download-stamp').isEnabled(), true);
  for (const page of [coaster, plaque, cookie]) {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  console.log('PASS mobile progress, worker cancellation, artwork retention, and successful retries in all three makers');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  ledger.close();
}
