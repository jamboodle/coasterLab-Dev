const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {unzipSync}=require('../dist/vendor/fflate.js');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.SITE_URL || 'http://127.0.0.1:3003');
  const image=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
   const context=canvas.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,64,64);context.fillStyle='#ff0000';context.fillRect(16,16,32,32);
   return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#files').setInputFiles({name:'test-coaster.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await page.locator('#trace').click();
  await page.waitForFunction(()=>!document.getElementById('download3MF').disabled,null,{timeout:60000});
  await page.locator('#download3MF').click();await page.locator('[data-authorize]').waitFor({state:'visible'});await page.locator('[data-authorize]').click();await page.locator('[data-save]').waitFor({state:'visible'});const pending=page.waitForEvent('download');await page.locator('[data-save]').click();const download=await pending;
  assert.match(download.suggestedFilename(),/\.3mf$/);
  assert.equal(await download.failure(),null);
  const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
  const files=unzipSync(Buffer.concat(chunks));
  assert.ok(files['[Content_Types].xml']);
  const models=Object.entries(files).filter(([name])=>name.endsWith('.model')).map(([,bytes])=>Buffer.from(bytes).toString('utf8'));
  assert.ok(models.some(xml=>xml.includes('<mesh>') && xml.includes('<vertices>') && xml.includes('<triangles>')),'3MF must contain an actual triangle mesh');
  const z = models.flatMap(xml => [...xml.matchAll(/<vertex [^>]* z="([^"]+)"/g)].map(match => +match[1]));
  assert.ok(z.some(height => Math.abs(height - 2.3) < 0.00001), '3MF contains the shallow top engraving');
  assert.ok(z.some(height => Math.abs(height - 2.5) < 0.00001), 'the full coaster top height remains');
  assert.deepEqual(errors,[]);
  console.log('PASS maker: PNG upload, worker tracing, WebAssembly geometry, downloaded 3MF archive and printable mesh');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
