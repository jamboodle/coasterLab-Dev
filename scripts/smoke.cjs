const assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(process.env.SITE_URL || 'http://127.0.0.1:3002');
    assert.equal(response.status(), 200);
    await page.waitForLoadState('networkidle');
    assert.match(await page.locator('.build-label').innerText(), /r27/);
    const manifest = await (await page.request.get(new URL('asset-manifest.json', page.url()).href)).json();
    assert.equal(manifest.build, 'coasterprint-r27');
    await page.locator('#bw').click();
    assert.equal(await page.locator('#bw').getAttribute('aria-pressed'), 'true');
    await page.locator('#color').click();
    assert.equal(await page.locator('#color').getAttribute('aria-pressed'), 'true');
    for (const path of ['asset-manifest.json','vendor/manifold.wasm','downloads/coasterprint-holder-pack.zip']) {
      const asset = await page.request.get(new URL(path, page.url()).href);
      assert.equal(asset.status(), 200, path);
      assert.ok((await asset.body()).length, path);
    }
    assert.deepEqual(errors, []);
    console.log('PASS standalone app: scripts, color controls, manifest, WebAssembly and holder downloads');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
