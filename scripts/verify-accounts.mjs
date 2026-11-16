import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
import {withStatic} from '../server/static.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const ledger=new Ledger(':memory:');let origin;
const api=(req,res)=>handler({ledger,origin,customerAccounts:true})(req,res);
const server=createServer(withStatic(api,fileURLToPath(new URL('../dist/',import.meta.url))));
await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/pricing/');await page.locator('#customer-login').waitFor({state:'visible'});
  assert.equal(await page.locator('#account-login').isVisible(),false);
  await page.locator('#customer-email').fill(`maker-${width}@example.com`);
  await page.locator('#customer-password').fill('browser-test-password');
  await page.locator('#customer-register').click();await page.locator('#connected-account').waitFor({state:'visible'});
  assert.equal(await page.locator('#account-balance').textContent(),'0');
  assert.equal(await page.locator('#test-checkout').isDisabled(),true);
  assert.equal(await page.locator('#customer-password').inputValue(),'');
  await page.reload();await page.locator('#connected-account').waitFor({state:'visible'});
  await page.locator('#disconnect-account').click();await page.locator('#customer-login').waitFor({state:'visible'});
  await page.locator('#customer-email').fill(`maker-${width}@example.com`);
  await page.locator('#customer-password').fill('incorrect-password');await page.locator('#customer-signin').click();
  await page.waitForFunction(()=>document.getElementById('account-status').textContent==='Email or password is incorrect.');
  await page.locator('#customer-password').fill('browser-test-password');await page.locator('#customer-signin').click();
  await page.locator('#connected-account').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  assert.deepEqual(errors,[]);await context.close();
  console.log(`PASS ${width}px customer account: registration, persistent session, logout, wrong password, sign-in and unavailable checkout`);
 }
}finally{await browser?.close();await new Promise(r=>server.close(r));ledger.close();}
