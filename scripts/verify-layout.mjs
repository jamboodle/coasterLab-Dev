import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
import {withStatic} from '../server/static.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const ledger=new Ledger(':memory:');
const server=createServer(withStatic(handler({ledger,origin:'http://127.0.0.1'}),fileURLToPath(new URL('../dist/',import.meta.url))));
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 for(const width of [1440,768,390,320]){
  const page=await browser.newPage({viewport:{width,height:1000},hasTouch:width<768,isMobile:width<768});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('h1').count(),1);
  assert.equal(await page.locator('#workflow, #guide').count(),0);
  assert.equal(await page.locator('a[href="#workflow"], a[href="#guide"]').count(),0);
  assert.equal(await page.locator('#holders').count(),1);
  for(const link of await page.locator('[data-maker-step]').all())assert.equal(await link.isVisible(),true);
  assert.equal(await page.locator('header').getByRole('link',{name:'Account & credits'}).isVisible(),true);
  assert.deepEqual(await page.locator('.maker-layout .maker-step').evaluateAll(nodes=>nodes.map(node=>node.id)),['upload-artwork','customize-coaster','build-coaster','download-coaster']);
  assert.equal(await page.locator('#advanced-artwork').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#advanced-model').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#batchOptions').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#trace').isDisabled(),true);
  assert.equal(await page.locator('#download3MF').isDisabled(),true);
  assert.equal(await page.locator('[data-maker-step="1"]').getAttribute('aria-current'),'step');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(width>760){const a=await page.locator('#upload-artwork').boundingBox(),b=await page.locator('#customize-coaster').boundingBox(),c=await page.locator('#build-coaster').boundingBox();assert.ok(Math.abs(a.width-b.width)<1);assert.ok(Math.abs(a.x-b.x)<1);assert.ok(Math.abs(a.y-c.y)<1);assert.ok(c.x>a.x);}
  if(width<768){const boxes=await page.locator('.maker-layout .maker-step').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().top));assert.ok(boxes.every((top,index)=>!index||top>boxes[index-1]));}
  await page.locator('#advanced-artwork > summary').click();assert.equal(await page.locator('#detail').isVisible(),true);
  await page.locator('#advanced-artwork > summary').click();
  const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.fillStyle='red';x.fillRect(0,0,64,64);return c.toDataURL().split(',')[1];});
  await page.locator('#files').setInputFiles({name:'layout-check.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  assert.equal(await page.locator('[data-maker-step="2"]').getAttribute('aria-current'),'step');
  await page.locator('#trace').click();await page.waitForFunction(()=>!document.getElementById('download3MF').disabled,null,{timeout:60000});
  assert.equal(await page.locator('[data-maker-step="4"]').getAttribute('aria-current'),'step');
  assert.equal(await page.locator('#go-download').isVisible(),true);
  assert.equal(await page.locator('.image-diagnostics').evaluate(el=>el.open),false);
  assert.equal(await page.locator('.image-files').evaluate(el=>el.open),false);
  assert.match(await page.locator('.status').textContent(),/Your coaster is ready/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('#maker').screenshot({path:`/tmp/coasterlab-layout-${width}.png`});
  assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${width}px guided maker: ordered steps, current stage, accessible advanced controls, real export and uncluttered preview`);
 }
}finally{await browser?.close();await new Promise(r=>server.close(r));ledger.close();}
