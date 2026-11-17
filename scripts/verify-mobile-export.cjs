const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {unzipSync}=require('../dist/vendor/fflate.js');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
 let baseline;
 try{
  for(const mobile of [false,true]){
   const context=await browser.newContext({viewport:{width:mobile?390:1280,height:900},hasTouch:mobile,isMobile:mobile});
   const page=await context.newPage(),workers=[],errors=[];let legacyRequests=0;
   for(const name of ['export-packing-worker.js','export-packing.js','export-credit-trial.js'])await page.route('**/'+name,route=>{legacyRequests++;return route.fulfill({contentType:'application/javascript',body:"onmessage=()=>postMessage({error: \"Cannot read properties of undefined (reading 'baseMM')\"});"});});
   page.on('worker',worker=>workers.push(worker.url()));page.on('pageerror',e=>errors.push(e.message));
   if(mobile){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});}
   await page.goto(process.env.SITE_URL || 'http://127.0.0.1:3003');
   assert.equal(await page.locator('#exportFormats').count(),0);assert.equal(await page.getByRole('button',{name:/Merged STL/i}).count(),0);
   const image=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.fillStyle='#ffffff';x.fillRect(0,0,128,128);
    for(let i=0;i<4;i++){x.fillStyle=['#ff0000','#008800','#0000ff','#ffcc00'][i];x.fillRect(16+i*24,16,20,96);}return c.toDataURL().split(',')[1];
   });
   await page.locator('#files').setInputFiles({name:'color-fixture.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
   await page.locator('#trace').click();await page.waitForFunction(()=>!document.getElementById('download3MF').disabled,null,{timeout:90000});
   const state=await page.evaluate(()=>({combined:Boolean(items[0].stl.combined),partsZip:Boolean(items[0].partsUrl),parts:items[0].stl.parts.length}));
   assert.equal(state.combined,false);assert.equal(state.partsZip,false);assert.ok(state.parts>0);
   await page.locator('#download3MF').click();await page.locator('[data-authorize]').waitFor({state:'visible'});await page.locator('[data-authorize]').click();await page.locator('[data-save]').waitFor({state:'visible'});const downloading=page.waitForEvent('download');await page.locator('[data-save]').click();const download=await downloading;
   const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
   const archive=unzipSync(Buffer.concat(chunks)),mesh=Buffer.from(archive['3D/3dmodel.model']).toString('utf8');
   assert.match(mesh,/<triangles>/);if(!mobile)baseline=mesh;else assert.equal(mesh,baseline,'3MF-only must preserve the exact model geometry and color assignments');
   assert.ok(workers.some(url=>/\/export-packing-worker\.[a-f0-9]{12}\.js$/.test(url)),'Model upload must be serialized in a worker');
   await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});
   const geometryWorkers=workers.filter(url=>url.includes('stl-worker')).length;
   assert.equal(await page.locator('#downloadSTL').isVisible(),true);
   await page.locator('#downloadSTL').click();await page.locator('[data-free-save]:not([disabled])').waitFor();
   assert.match(await page.locator('[data-progress]').textContent(),/No login or credits needed/);
   let pending=page.waitForEvent('download');await page.locator('[data-free-save]').click();let free=await pending;
   assert.match(free.suggestedFilename(),/-stl-parts\.zip$/);
   let bytes=[];for await(const chunk of await free.createReadStream())bytes.push(chunk);
   const parts=unzipSync(Buffer.concat(bytes));const names=Object.keys(parts);assert.ok(names.some(name=>name.startsWith('base-')&&name.endsWith('.stl')));assert.ok(names.filter(name=>name.startsWith('image-color-')&&name.endsWith('.stl')).length>1);assert.ok(names.every(name=>!name.endsWith('.3mf')&&!/merged|combined/i.test(name)));
   const colorMap=JSON.parse(Buffer.from(parts['colors.json']).toString());const hashes=await page.evaluate(async()=>{const digest=async buffer=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),n=>n.toString(16).padStart(2,'0')).join('');return {base:await digest(items[0].stl.base.buffer),colors:await Promise.all(items[0].stl.parts.map(part=>digest(part.buffer)))};});
   const hash=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');assert.equal(hash(parts[colorMap.base.file]),hashes.base);colorMap.colors.forEach((color,index)=>assert.equal(hash(parts[color.file]),hashes.colors[index]));
   assert.match(Buffer.from(parts['IMPORT-INTO-BAMBU.txt']).toString(),/SINGLE object with multiple parts/);
   await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});
   await page.evaluate(()=>window.freeSTLDownload([items[0],{...items[0],file:{name:'second-coaster.png'}}]));
   pending=page.waitForEvent('download');await page.locator('[data-free-save]').click();free=await pending;bytes=[];for await(const chunk of await free.createReadStream())bytes.push(chunk);
   const batch=Object.keys(unzipSync(Buffer.concat(bytes)));assert.ok(batch.includes('START-HERE.txt'));assert.equal(batch.filter(name=>name.endsWith('/colors.json')).length,2);
   assert.equal(workers.filter(url=>url.includes('stl-worker')).length,geometryWorkers,'Free STL ZIP must reuse the existing geometry without rebuilding');
   assert.equal(legacyRequests,0,'Current exports must never load stale unversioned packing scripts');assert.deepEqual(errors,[]);await context.close();
   console.log(`PASS ${mobile?'touch device, 4× CPU throttle':'desktop'}: exact 3MF geometry, visible free ZIP, separate color STLs, batch folders and no geometry rebuild`);
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
