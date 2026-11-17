const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {unzipSync}=require('../dist/vendor/fflate.js');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
 let baseline;
 try{
  for(const mobile of [false,true]){
   const context=await browser.newContext({viewport:{width:mobile?390:1280,height:900},hasTouch:mobile,isMobile:mobile});
   const page=await context.newPage(),workers=[],errors=[];
   page.on('worker',worker=>workers.push(worker.url()));page.on('pageerror',e=>errors.push(e.message));
   if(mobile){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});}
   await page.goto(process.env.SITE_URL || 'http://127.0.0.1:3003');
   assert.equal(await page.locator('#exportFormats').inputValue(),mobile?'3mf':'all');
   const image=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.fillStyle='#ffffff';x.fillRect(0,0,128,128);
    for(let i=0;i<4;i++){x.fillStyle=['#ff0000','#008800','#0000ff','#ffcc00'][i];x.fillRect(16+i*24,16,20,96);}return c.toDataURL().split(',')[1];
   });
   await page.locator('#files').setInputFiles({name:'color-fixture.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
   await page.locator('#trace').click();await page.waitForFunction(()=>!document.getElementById('download3MF').disabled,null,{timeout:90000});
   const state=await page.evaluate(()=>({combined:Boolean(items[0].stl.combined),partsZip:Boolean(items[0].partsUrl),parts:items[0].stl.parts.length}));
   assert.equal(state.combined,!mobile);assert.equal(state.partsZip,!mobile);assert.ok(state.parts>0);
   const downloading=page.waitForEvent('download');await page.locator('#download3MF').click();const download=await downloading;
   const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
   const archive=unzipSync(Buffer.concat(chunks)),mesh=Buffer.from(archive['3D/3dmodel.model']).toString('utf8');
   assert.match(mesh,/<triangles>/);if(!mobile)baseline=mesh;else assert.equal(mesh,baseline,'3MF-only must preserve the exact model geometry and color assignments');
   assert.ok(workers.some(url=>url.endsWith('/export-packing-worker.js')),'3MF must be packed in a worker');
   if(mobile){
    await page.locator('#advanced-model > summary').click();
    await page.locator('#exportFormats').selectOption('all');
    await page.locator('#buildSTL').click();await page.waitForFunction(()=>!document.getElementById('download3MF').disabled,null,{timeout:90000});
    assert.ok(await page.evaluate(()=>Boolean(items[0].stlUrl && items[0].partsUrl)),'Touch devices can opt back into STL formats');
   }
   assert.deepEqual(errors,[]);await context.close();
   console.log(`PASS ${mobile?'touch device, 4× CPU throttle':'desktop'}: download mode, archive worker, exact 3MF geometry and optional STL outputs`);
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
