const $=id=>document.getElementById(id);const MAX_BATCH_IMAGES=6;const COASTERPRINT_BUILD='coasterprint-r27';let items=[],mode='color',busy=false,nextId=0;const sizes=n=>n>1048576?(n/1048576).toFixed(1)+' MB':Math.round(n/1024)+' KB';
function render(){ $('queue').replaceChildren();for(const item of items){const card=document.createElement('div');card.className='card';const thumb=document.createElement('div');thumb.className='thumb';const img=document.createElement('img');img.src=item.svgUrl||item.url;img.alt=item.svg?'Traced '+item.file.name:item.file.name;thumb.append(img);const info=document.createElement('div');info.className='info';const name=document.createElement('div');name.className='name';name.textContent=item.file.name;name.title=item.file.name;const status=document.createElement('div');status.className='status'+(item.error?' error':'');status.textContent=item.error||item.status;if(item.traceStale&&item.svg)status.textContent='Settings changed — retrace artwork to update this preview.';if(item.traceAdvice&&!item.traceStale)status.textContent+='\n'+item.traceAdvice;if(item.stl){const box=item.stl.dimensions;status.textContent+='\n3D: '+(box.max[0]-box.min[0]).toFixed(1)+' × '+(box.max[1]-box.min[1]).toFixed(1)+' × '+(box.max[2]-box.min[2]).toFixed(1)+' mm';}if(item.stl?.warnings?.length)status.textContent+='\n'+item.stl.warnings.join(' ');if(item.stlError)status.textContent+='\nSTL: '+item.stlError;const actions=document.createElement('div');actions.className='actions';if(item.svg){const dl=document.createElement('button');dl.textContent='↓ Download SVG';dl.disabled=busy||!!item.traceStale;dl.onclick=()=>download(item.svgUrl,item.outname);actions.append(dl);const compare=document.createElement('button');compare.textContent='View original';compare.onclick=()=>{const original=img.src===item.url;img.src=original?item.svgUrl:item.url;compare.textContent=original?'View original':'View SVG';};actions.append(compare);if(item.stl){const project=document.createElement('button');project.textContent='Download 3MF';project.disabled=busy||!!item.traceStale;project.onclick=()=>void downloadProject([item]);actions.append(project);const free=document.createElement('button');free.textContent='Free STL parts ZIP';free.disabled=busy;free.onclick=()=>void window.freeSTLDownload([item]);actions.append(free);for(const [label,url,name]of [['↓ STL parts ZIP',item.partsUrl,item.outname.replace(/\.svg$/,'-color-parts.zip')]]){if(!url)continue;const btn=document.createElement('button');btn.textContent=label;btn.onclick=()=>download(url,name);actions.append(btn);}}}else{const remove=document.createElement('button');remove.textContent='Remove';remove.disabled=busy;remove.onclick=()=>removeItem(item);actions.append(remove);}const diagnostics=status.textContent;status.textContent=item.error||item.stlError||(item.traceStale?'Settings changed. Rebuild your coaster.':item.threeMF?'Your coaster is ready.':item.svg?'Artwork traced. Ready to build.':item.status);if(item.stl)status.textContent+='\n'+(item.stl.dimensions.max[0]-item.stl.dimensions.min[0]).toFixed(1)+' × '+(item.stl.dimensions.max[1]-item.stl.dimensions.min[1]).toFixed(1)+' mm';info.append(name,status);if(item.svg){const remove=document.createElement('button');remove.textContent='Remove image';remove.className='quiet';remove.disabled=busy;remove.onclick=()=>removeItem(item);info.append(remove);const compare=[...actions.children].find(button=>button.textContent==='View original');if(compare)info.append(compare);const files=document.createElement('details');files.className='image-files';const heading=document.createElement('summary');heading.textContent='Individual downloads';files.append(heading,actions);info.append(files);const details=document.createElement('details');details.className='image-diagnostics';const summary=document.createElement('summary');summary.textContent='Build details';const text=document.createElement('p');text.textContent=diagnostics;details.append(summary,text);info.append(details);}else info.append(actions);card.append(thumb,info);$('queue').append(card);}const ready=items.filter(x=>x.svg&&!x.traceStale).length;$('empty').hidden=items.length>0;$('trace').disabled=!items.length||busy;$('clear').disabled=!items.length||busy;$('download').disabled=!ready||busy;$('buildSTL').disabled=!ready||busy;const models=items.filter(i=>i.stl).length;$('downloadSTL').disabled=!items.some(i=>i.stl&&!i.traceStale)||busy;$('download3MF').disabled=!items.some(i=>i.threeMF)||busy;$('download3MF').textContent=models>1?'Download batch 3MF':'Download 3MF';$('downloadSTL').textContent=models>1?'Download free STL parts ZIP · batch':'Download free STL parts ZIP';$('total').textContent=items.length?items.length+' image'+(items.length===1?'':'s')+' added':'';$('summary').textContent=models?models+' of '+items.length+' coaster'+(items.length===1?'':'s')+' ready to download.':items.length?'Build your coaster to unlock the download.':'Your download will be ready after you build a coaster.';$('download').textContent=ready===1?'↓ Download SVG':'↓ Download ZIP';$('trace').textContent=busy?'Building your coaster…':items.some(i=>i.svg)?'Rebuild coaster →':'Build coaster →';for(const id of ['bw','color','colors','threshold','detail','files','removeBackground','smoothOuter','cleanEdgeSpecks','sealOuterRim','edgeStrength','pinholeArea','autoSTL','modelWidth','baseHeight','topHeight'])$(id).disabled=busy;$('edgeStrength').disabled=busy||!$('smoothOuter').checked;if(typeof updateBatchControls==='function')updateBatchControls();const stage=busy?3:items.some(i=>i.threeMF)?4:items.length?2:1;$('trace').classList.toggle('ready-to-rebuild',stage===4);if($('go-download'))$('go-download').hidden=stage!==4;for(const link of document.querySelectorAll('[data-maker-step]')){if(Number(link.dataset.makerStep)===stage)link.setAttribute('aria-current','step');else link.removeAttribute('aria-current');}if($('maker-next'))$('maker-next').textContent=busy?'Keep this tab open while we build your coaster.':stage===4?'Your coaster is ready. Continue to step 4 to download.':items.length?'Choose your colors and size, then build your coaster.':'Start by adding an image below.';}
let currentMakerAccess={registered:false,credits:0,maxImages:1},addingFiles=false;
async function refreshMakerAccess(signal){
 const timeout=AbortSignal.timeout(10000);
 try{const response=await fetch('/api/maker-access',{credentials:'same-origin',signal:signal&&typeof AbortSignal.any==="function"?AbortSignal.any([signal,timeout]):signal||timeout});if(!response.ok)throw Error();const access=await response.json();currentMakerAccess={registered:access.registered===true,credits:Number(access.credits)||0,pro:access.pro===true,maxImages:access.maxImages===6?6:1};}
 catch{signal?.throwIfAborted();currentMakerAccess={registered:false,credits:0,maxImages:1};}
 $('files').multiple=currentMakerAccess.maxImages>1;
 if($('upload-limit'))$('upload-limit').textContent=currentMakerAccess.maxImages===6?'JPG or PNG · up to 6 images · 20 MB each':'JPG or PNG · 1 image at a time · 20 MB';
 if($('batch-access'))$('batch-access').textContent=currentMakerAccess.maxImages===6?'Batch access: up to 6 images. Processing is free and does not spend credits.':currentMakerAccess.registered?'Your balance is zero: process 1 image at a time. Add credits to unlock batches of up to 6.':'Guests can process 1 image at a time. Sign in with a positive credit balance to process up to 6.';
 return currentMakerAccess;
}
async function checkProcessingAccess(count=items.length,signal){const access=await refreshMakerAccess(signal);if(count<=access.maxImages)return true;$('notice').textContent=`This account can process ${access.maxImages} image${access.maxImages===1?'':'s'} at a time. Remove images to continue, or sign in with a positive credit balance for batches of up to 6. Processing never spends credits.`;return false;}
function removeItem(item){if(busy)return;clearSTL(item);URL.revokeObjectURL(item.url);if(item.svgUrl)URL.revokeObjectURL(item.svgUrl);items=items.filter(candidate=>candidate!==item);invalidateTraceOutputs();render();}
async function addFiles(files){
 if(busy||addingFiles)return 'The maker is busy. Try again in a moment.';addingFiles=true;
 try{const access=await refreshMakerAccess();if(busy)return 'The maker is busy. Try again in a moment.';const previousCount=items.length,errors=[];
 for(const file of files){if(!/\.(png|jpe?g)$/i.test(file.name)){errors.push(file.name+': use JPG or PNG.');continue;}if(file.size>20*1024*1024){errors.push(file.name+': exceeds 20 MB.');continue;}if(items.length>=access.maxImages){errors.push(access.maxImages===1?'Only 1 image at a time. Clear or remove the current image, or sign in with a positive credit balance for batches of up to 6.':'Batch limit is 6 images. Remove an image before adding another.');break;}items.push({id:++nextId,file,url:URL.createObjectURL(file),status:sizes(file.size)+' · Ready to trace'});}
 if(items.length!==previousCount)invalidateTraceOutputs();$('notice').textContent=errors.join(' ')||items.length+' image(s) added. Processing is free.';render();$('files').value='';
 return errors[0] || '';
 }finally{addingFiles=false;}
}
let artworkWindow;
const artworkLink = $('artwork-library');
if (artworkLink) {
 artworkLink.addEventListener('click', event => {
  event.preventDefault();
  artworkWindow = window.open(artworkLink.href, 'coasterprint-artwork', 'popup,width=1100,height=800');
  if (artworkWindow) artworkWindow.focus();
  else $('notice').textContent = 'Allow pop-ups for this site to open the artwork library.';
 });
 window.coasterPrintImportArtwork = async (source, file) => {
  if (source !== artworkWindow) return 'Open the artwork library from the maker.';
  const error = await addFiles([file]);
  if (!error) $('queue').scrollIntoView({block: 'nearest'});
  return error;
 };
}
window.addEventListener('focus',()=>void refreshMakerAccess());window.addEventListener('coasterprint-balance',()=>void refreshMakerAccess());void refreshMakerAccess();
$('files').onchange=e=>addFiles(e.target.files);$('drop').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('files').click();}};for(const event of ['dragover','dragleave','drop'])$('drop').addEventListener(event,e=>{e.preventDefault();$('drop').classList.toggle('over',event==='dragover');if(event==='drop')addFiles(e.dataTransfer.files);});
for(const m of ['bw','color'])$(m).onclick=()=>{mode=m;for(const n of ['bw','color']){$(n).classList.toggle('active',n===m);$(n).setAttribute('aria-pressed',n===m);}$('colorsbox').hidden=m==='bw';$('thresholdbox').hidden=m!=='bw';};$('colors').oninput=e=>$('count').textContent=e.target.value;$('threshold').oninput=e=>$('thresholdvalue').textContent=e.target.value;
$('clear').onclick=()=>{for(const item of items){clearSTL(item);URL.revokeObjectURL(item.url);if(item.svgUrl)URL.revokeObjectURL(item.svgUrl);}items=[];$('notice').textContent='Add an image to start your coaster.';render();};
async function decodeTraceImage(file){const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>80000000){bitmap.close();throw Error('Image is too large to decode safely. Resize it first.');}const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{willReadFrequently:true});try{ctx.drawImage(bitmap,0,0,width,height);return {pixels:ctx.getImageData(0,0,width,height).data,width,height,scale};}finally{bitmap.close();canvas.width=canvas.height=1;}}
async function collectBatchPalette(settings,build){
 const samples=[];
 for(let n=0;n<items.length;n++){
  const item=items[n];
  item.status='Reading batch colors…';
  build.update('Choosing shared colors · image '+(n+1)+' of '+items.length+'…');
  render();
  try{
   const image=await decodeTraceImage(item.file);
   const result=await traceWorker({id:item.id,action:'sample',...image,removeBackground:settings.removeBackground},build.signal);
   samples.push(result.samples);
  }catch(error){
   build.signal.throwIfAborted();
   item.paletteError=error.message||'Could not read this image.';
  }
 }
 if(!samples.length)return null;
 const pixels=new Uint8ClampedArray(samples.reduce((n,s)=>n+s.length,0));
 let offset=0;
 for(const sample of samples){pixels.set(sample,offset);offset+=sample.length;}
 build.update('Building one '+settings.colors+'-color palette for the batch…');
 try{
  return (await traceWorker({action:'palette',pixels,width:pixels.length/4,height:1,colors:settings.colors},build.signal)).sharedPalette;
 }catch(error){
  build.signal.throwIfAborted();
  for(const item of items)item.paletteError=error.message;
  return null;
 }
}
async function traceWorker(data,signal){
 const runId='trace-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
 const result=await window.runMakerWorker('worker.74127e14aef2.js',undefined,{...data,runId},{
  signal,transfer:[data.pixels.buffer],engineError:'Unable to run the tracing engine.',
  timeoutMessage:'Tracing took too long. Try smoother detail or a smaller image.'
 });
 if(result.build!==COASTERPRINT_BUILD||result.runId!==runId)throw Error('A stale tracing script was loaded. Open coasterprint-r27.html and retrace.');
 return result;
}
$('trace').onclick=async()=>{
 if(busy||!items.length)return;
 busy=true;
 const build=window.startMakerBuild('Checking upload access…',$('notice'));
 render();
 try{
  if(!await checkProcessingAccess(items.length,build.signal))return;
  build.signal.throwIfAborted();
  const printSettings=$('autoSTL').checked?stlSettings():null;
  let failures=0;
  const settings={
   mode, colors:+$('colors').value, threshold:+$('threshold').value, detail:$('detail').value,
   removeBackground:$('removeBackground').checked, smoothOuter:$('smoothOuter').checked,
   cleanEdgeSpecks:$('cleanEdgeSpecks').checked, sealOuterRim:$('sealOuterRim').checked,
   edgeStrength:$('edgeStrength').value, pinholeArea:+$('pinholeArea').value
  };
  for(const item of items)delete item.paletteError;
  const sharedPalette=mode==='color'&&items.length>1?await collectBatchPalette(settings,build):null;
  for(const [index,item] of items.entries()){
   build.signal.throwIfAborted();
   item.error=item.traceAdvice=item.traceInfo=null;
   item.traceStale=true;
   clearSTL(item);
   item.svg=null;
   const traceStarted=performance.now();
   if(item.svgUrl){URL.revokeObjectURL(item.svgUrl);item.svgUrl=null;}
   item.status='Tracing artwork…';
   build.update('Tracing artwork · image '+(index+1)+' of '+items.length+'…');
   render();
   try{
    if(item.paletteError)throw Error(item.paletteError);
    const {pixels,width,height,scale}=await decodeTraceImage(item.file);
    const info=await traceWorker({id:item.id,pixels,width,height,sharedPalette,...settings},build.signal);
    item.svg=info.svg;
    item.traceInfo=info;
    item.traceStale=false;
    item.svgUrl=URL.createObjectURL(new Blob([item.svg],{type:'image/svg+xml'}));
    item.outname=String(index+1).padStart(2,'0')+'-'+item.file.name.replace(/\.[^.]+$/,'')+'.svg';
    const sm=info.smoothing;
    item.status='SVG regenerated · r27 · '+new Date(info.createdAt).toLocaleTimeString()+
     ' · '+Math.round(performance.now()-traceStarted)+' ms\n'+
     (sm.enabled?sm.strength+' edge · '+sm.movedPoints+' boundary points adjusted':'Edge smoothing off')+
     ' · '+(info.edgeCleanup?.removedComponents||0)+' edge flecks removed'+(info.rimSealPx?' · rim sealed':'')+
     (info.sharedPalette?' · '+info.sharedPalette.length+' shared batch colors':'')+
     ' · geometry '+info.geometryHash+(scale<1?'\nTraced at '+width+' × '+height:'');
    if(sm.enabled&&!sm.exteriorTransparentPixels)item.traceAdvice='Tip: no transparent outside background was found. If your coaster has a curved outline inside a solid background, enable Remove edge background and retrace to expose it.';
    else if(sm.enabled&&!sm.movedPoints)item.traceAdvice='This setting adjusted 0 perimeter points. Try Strong if the edge still looks rough.';
    if(printSettings){
     build.update('Building 3D model '+(index+1)+' of '+items.length+'…');
     render();
     await generateItemSTL(item,printSettings,build);
    }
   }catch(error){
    if(build.signal.aborted){
     item.status=item.svg?'Artwork traced · 3D build cancelled.':'Trace cancelled.';
     throw error;
    }
    item.error=error.message||'Could not process this image.';
    failures++;
   }
   render();
  }
  const buildFailures=items.filter(item=>item.stlError);
  if(failures)$('notice').textContent=failures+' image(s) failed. Successful SVGs are available to download.';
  else if(buildFailures.length)$('notice').textContent=buildFailures.map(item=>item.file.name+': '+item.stlError).join(' | ');
  else $('notice').textContent=printSettings?'All done. SVGs and Bambu 3MFs are ready.':'All done. Your SVGs are ready to download.';
 }catch(error){
  $('notice').textContent=error.message;
 }finally{
  const restoreFocus=build.finish();
  busy=false;
  render();
  if(restoreFocus)$('trace').focus({preventScroll:true});
 }
};
function download(url,name,count=1,contains3MF=false){if(/\.3mf$/i.test(name)||contains3MF){$('notice').textContent='Use the secure 3MF download button.';return;}const a=document.createElement('a');a.href=url;a.download=name;a.click();}$('download').onclick=()=>{const ready=items.filter(x=>x.svg&&!x.traceStale);if(ready.length===1){download(ready[0].svgUrl,ready[0].outname);return;}const files={};for(const item of ready)files[item.outname]=fflate.strToU8(item.svg);const url=URL.createObjectURL(new Blob([fflate.zipSync(files,{level:6})],{type:'application/zip'}));download(url,'coasterprint-svgs.zip');setTimeout(()=>URL.revokeObjectURL(url),30000);};

$('smoothOuter').addEventListener('change',()=>{$('edgeStrength').disabled=busy||!$('smoothOuter').checked;});

function invalidateTraceOutputs(){if(busy)return;let changed=false;for(const item of items){if(!item.svg)continue;item.traceStale=true;clearSTL(item);changed=true;}if(changed){$('notice').textContent='Tracing settings changed. Click Retrace artwork to create a fresh SVG and 3MF. Build / rebuild coaster uses the SVG and cannot apply new tracing settings.';render();}}
for(const id of ['colors','threshold'])$(id).addEventListener('input',invalidateTraceOutputs);
for(const id of ['detail','removeBackground','smoothOuter','cleanEdgeSpecks','sealOuterRim','edgeStrength','pinholeArea'])$(id).addEventListener('change',invalidateTraceOutputs);
for(const id of ['bw','color'])$(id).addEventListener('click',invalidateTraceOutputs);

const proCoasterControls=['colors','threshold','detail','removeBackground','smoothOuter','cleanEdgeSpecks','sealOuterRim','edgeStrength','pinholeArea','modelWidth','baseHeight','topHeight','autoSTL'];
window.addEventListener('DOMContentLoaded',()=>{
 void window.mountProLibrary({
  maker:'coaster',anchor:$('customize-coaster'),
  settings:()=>({mode,controls:window.proControlValues(proCoasterControls)}),
  files:()=>items.map(item=>item.file),
  async apply(saved,files){
   if(busy||addingFiles)throw Error('Wait until the maker is ready.');
   if(files.length){$('clear').click();const error=await addFiles(files);if(error)throw Error(error);}
   $(saved.mode==='bw'?'bw':'color').click();
   window.proControlValues(proCoasterControls,saved.controls);
   for(const id of proCoasterControls)$(id).dispatchEvent(new Event('input'));
   invalidateTraceOutputs();
   render();
  }
 });
});
