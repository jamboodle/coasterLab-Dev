const assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox']});
  try {
    for (const width of [1440,768,390,320]) {
      const page = await browser.newPage({viewport:{width,height:900}});
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(process.env.SITE_URL || 'http://127.0.0.1:3002');
      await page.getByRole('link',{name:'Pricing preview',exact:true}).last().click();
      assert.match(await page.title(), /Pricing preview/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const opener = page.getByRole('button',{name:'Preview the credit flow →'});
      await opener.click();
      assert.equal(await page.getByRole('dialog').isVisible(), true);
      await page.getByRole('button',{name:'Simulate export',exact:true}).click();
      assert.match(await page.locator('#credit-status').textContent(), /Not enough/);
      assert.equal(await page.locator('#balance').textContent(),'0');
      await page.locator('#add-credits').click();
      await page.locator('#quantity').fill('3');
      assert.equal(await page.locator('#cost').textContent(),'Cost: 3 demo credits');
      await page.locator('#export-preview').click();
      assert.equal(await page.locator('#balance').textContent(),'7');
      assert.match(await page.locator('#credit-status').textContent(), /No file was generated/);
      await page.locator('#quantity').fill('1.5');
      await page.locator('#export-preview').click();
      assert.equal(await page.locator('#balance').textContent(),'7');
      assert.match(await page.locator('#credit-status').textContent(), /whole number/);
      await page.locator('#quantity').fill('10');
      await page.locator('#export-preview').click();
      assert.equal(await page.locator('#balance').textContent(),'7');
      await page.locator('#reset-preview').click();
      assert.equal(await page.locator('#balance').textContent(),'0');
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').isVisible(),false);
      assert.equal(await opener.evaluate(el => el === document.activeElement),true);
      await page.reload();
      assert.equal(await page.locator('#balance').textContent(),'0');
      assert.deepEqual(errors,[]);
      console.log(`PASS ${width}px: pricing navigation, demo credits, export cost, invalid input, insufficient balance, reset and dialog keyboard behavior`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exitCode=1;});
