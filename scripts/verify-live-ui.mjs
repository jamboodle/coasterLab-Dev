import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
import {publicSettings} from '../server/admin.mjs';
import {withStatic} from '../server/static.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const ledger=new Ledger(':memory:'),account=ledger.registerIdentity('buyer@example.com','salt','digest');let origin,mode='live';
const api=(req,res)=>{if(req.url==='/api/config'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({...publicSettings(ledger.settings()),customerAccounts:true,developmentLogin:false,emailEnabled:false,mode,paymentsEnabled:true}));return;}return handler({ledger,origin,customerAccounts:true,fetchImpl:async()=>{throw Error('Unexpected external provider call');}})(req,res);};
const server=createServer(withStatic(api,fileURLToPath(new URL('../dist/',import.meta.url))));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'cl_session',value:ledger.createSession(account),url:origin,httpOnly:true,sameSite:'Strict'}]);const page=await context.newPage(),errors=[],attempts=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/checkout',async route=>{const body=route.request().postDataJSON();attempts.push({body,key:route.request().headers()['idempotency-key']});if(body.mode!==mode){await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'checkout_mode_changed',error:'Mode changed'})});return;}await route.fulfill({contentType:'application/json',body:JSON.stringify({url:'https://checkout.stripe.com/fixture'})});});
 await page.route('https://checkout.stripe.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Mock checkout — no real charge</h1>'}));
 await page.goto(origin+'/pricing/');await page.locator('#connected-account').waitFor({state:'visible'});assert.match(await page.locator('#test-checkout').textContent(),/Buy credits/);assert.doesNotMatch(await page.locator('#payment-note').textContent(),/Sandbox|no real money/i);
 await page.locator('[name=credit-pack][value=standard]').check();assert.match(await page.locator('#purchase-hint').textContent(),/pay \$10.00 USD for 50 credits/);await page.locator('#test-checkout').click();await page.waitForURL('https://checkout.stripe.com/**');assert.equal(attempts[0].body.mode,'live');assert.equal(attempts[0].body.pack,'standard');
 await page.goto(origin+'/pricing/?checkout=canceled&pack=standard&paymentMode=live');await page.locator('#connected-account').waitFor({state:'visible'});await page.locator('#test-checkout').click();await page.waitForURL('https://checkout.stripe.com/**');assert.equal(attempts[1].key,attempts[0].key,'Live retry should reuse its original reference');
 await page.goto(origin+'/pricing/?pack=standard');await page.locator('#connected-account').waitFor({state:'visible'});mode='test';await page.locator('#test-checkout').click();await page.waitForFunction(()=>document.getElementById('payment-badge').textContent==='Sandbox');await page.locator('#connected-account').waitFor({state:'visible'});assert.match(await page.locator('#test-checkout').textContent(),/Open test checkout/);
 await page.locator('#test-checkout').click();await page.waitForURL('https://checkout.stripe.com/**');assert.equal(attempts.at(-1).body.mode,'test');assert.notEqual(attempts.at(-1).key,attempts[0].key);assert.equal(ledger.balance(account),15);assert.deepEqual(errors,[]);console.log('PASS live checkout wording, USD amount disclosure, isolated retry keys and safe refresh on payment-mode changes (all provider traffic mocked)');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));ledger.close();}
