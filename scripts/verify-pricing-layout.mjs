import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
import {withStatic} from '../server/static.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const ledger=new Ledger(':memory:');let origin;
const server=createServer(withStatic((req,res)=>handler({ledger,origin,customerAccounts:true})(req,res),fileURLToPath(new URL('../dist/',import.meta.url))));
await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 for(const width of [1440,768,390,320]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/pricing/');await page.locator('#customer-login').waitFor({state:'visible'});
  assert.equal(await page.locator('#customer-signin').isVisible(),true);
  assert.equal(await page.locator('#customer-register').isVisible(),false);
  assert.equal(await page.locator('.sidebar-details').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#test-checkout').isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.ok(await page.locator('h1').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)<=36));
  assert.ok((await page.locator('#customer-signin').boundingBox()).y<760,'Sign-in should be reachable without passing pricing cards');
  if(width<701){const a=await page.locator('.account-card').boundingBox(),b=await page.locator('.credits-sidebar').boundingBox();assert.ok(a.y<b.y);}
  await page.screenshot({path:`/tmp/coasterprint-pricing-signedout-${width}.png`,fullPage:true});
  await page.locator('#auth-register').click();
  assert.equal(await page.locator('#customer-password').getAttribute('autocomplete'),'new-password');
  assert.equal(await page.locator('#customer-signin').isVisible(),false);
  await page.locator('#customer-email').fill(`layout-${width}@example.com`);await page.locator('#customer-password').fill('pricing-layout-password');
  await page.locator('#customer-register').click();await page.locator('#connected-account').waitFor({state:'visible'});
  assert.equal(await page.locator('#account-email').textContent(),`layout-${width}@example.com`);
  assert.equal(await page.locator('#account-balance').textContent(),'15');
  assert.equal(await page.locator('#activity-panel').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#account-security').evaluate(el=>el.open),false);
  await page.screenshot({path:`/tmp/coasterprint-pricing-signedin-${width}.png`,fullPage:true});
  await page.locator('#activity-panel > summary').click();assert.equal(await page.locator('#account-activity').isVisible(),true);
  await page.locator('#disconnect-account').click();await page.locator('#customer-login').waitFor({state:'visible'});
  assert.equal(await page.locator('#auth-signin').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#test-checkout').isDisabled(),true);
  assert.equal(await page.locator('#customer-password').getAttribute('autocomplete'),'current-password');
  assert.deepEqual(errors,[]);await context.close();
  console.log(`PASS ${width}px compact pricing: account-first layout, explicit auth modes, balance, collapsed settings and disabled purchases`);
 }
}finally{await browser?.close();await new Promise(r=>server.close(r));ledger.close();}
