import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto(process.env.SITE_URL||'http://127.0.0.1:3003');
 const manifest=await (await page.request.get(new URL('/asset-manifest.json',page.url()).href)).json();
 for(const name of ['export-packing.js','export-packing-worker.js','export-credit-trial.js'])assert.match(manifest.scripts[name],/\.[a-f0-9]{12}\.js$/);
 await page.route('**/export-packing-worker.*.js',route=>route.fulfill({contentType:'application/javascript',body:`onmessage=()=>postMessage({error:"Cannot read properties of undefined (reading 'baseMM')"});`}));
 const stale=await page.evaluate(async()=>{try{await packInWorker('upload',{items:[],template:{},format:'project'});}catch(error){return error.message;}});
 assert.match(stale,/out of date.*Reload/);assert.doesNotMatch(stale,/baseMM/);
 await page.unroute('**/export-packing-worker.*.js');
 const invalid=await page.evaluate(async()=>{try{await packInWorker('parts',{item:{},result:undefined});}catch(error){return error.message;}});
 assert.match(invalid,/model is not ready.*Rebuild/);assert.doesNotMatch(invalid,/baseMM/);
 console.log('PASS versioned export assets, stale-worker protocol error and missing-model recovery');
}finally{await browser.close();}
