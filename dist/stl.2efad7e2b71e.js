function exportErrorMessage(message){const text=String(message||'3D export failed.');if(!/zero area|triangle collapsed/i.test(text))return text;return text.replace(/Try smoother tracing\.?/i,'').replace(/\.\s*\./g,'.').trim()+' Increase Maximum colors (for example, from 4 to 6 or 8), then retrace your artwork and rebuild the 3D model. Increasing colors can help separate merged details.';}
function stlSettings(){const values={includeSTL:false,widthMM:+$('modelWidth').value,baseMM:+$('baseHeight').value,topMM:+$('topHeight').value};for(const [key,n]of Object.entries(values).filter(([key])=>key!=='includeSTL'))if(!Number.isFinite(n)||n<=0||n>({widthMM:500,baseMM:20,topMM:10}[key]))throw Error('Use a width of 1–500 mm, base of 0.1–20 mm and raised layer of 0.1–10 mm.');if(values.widthMM<1||values.baseMM<.1||values.topMM<.1)throw Error('Model dimensions are too small.');return values;}
function clearSTL(item){for(const key of ['stlUrl','partsUrl','threeMFUrl'])if(item[key])URL.revokeObjectURL(item[key]);item.threeMFUrl=null;item.threeMF=null;item.stlUrl=null;item.partsUrl=null;item.stl=null;item.stlError=null;}
function makeSTL(svg,settings,build){const doc=new DOMParser().parseFromString(svg,'image/svg+xml');const box=(doc.documentElement.getAttribute('viewBox')||'').split(/[ ,]+/).map(Number);const metadata=doc.querySelector('#coasterprint-trace') || doc.querySelector('#coasterlab-trace');let rimSealPx=0,edgeRemovedD='',perimeterD='',perimeterMaskD='',perimeterFill='',perimeterRimPx=0;if(metadata){try{const trace=JSON.parse(metadata.textContent);rimSealPx=Math.max(0,+trace.rimSealPx||0);edgeRemovedD=trace.edgeCleanup?.removedRegionsD||'';if(trace.perimeterPathID){perimeterD=doc.getElementById(trace.perimeterPathID)?.getAttribute('d')||'';perimeterMaskD=doc.getElementById(trace.perimeterMaskPathID)?.getAttribute('d')||'';perimeterFill=trace.perimeterFill;perimeterRimPx=+trace.perimeterRimPx||0;}}catch{}}const paths=[...doc.querySelectorAll('path')].filter(p=>!p.closest('defs')&&p.getAttribute('fill')!=='none'&&p.getAttribute('opacity')!=='0').map(p=>({d:p.getAttribute('d'),fill:p.getAttribute('fill')||'#000000',fillRule:p.getAttribute('fill-rule')||'nonzero'}));return window.runMakerWorker('stl-worker.c49183876b33.js',{type:'module'},
 {paths,rimSealPx,edgeRemovedD,perimeterD,perimeterMaskD,perimeterFill,perimeterRimPx,viewWidth:box[2],...settings},{
  signal:build.signal,onProgress:build.update,timeout:180000,
  timeoutMessage:'STL generation timed out. Try fewer colors or smoother tracing.',
  engineError:'Could not load the 3D engine. Serve the app over HTTP/HTTPS and allow WebAssembly.'
 });
}
async function generateItemSTL(item,settings,build){
 try{
  const result=await makeSTL(item.svg,settings,build);
  clearSTL(item);
  if(result.warnings)result.warnings=result.warnings.map(exportErrorMessage);
  item.stl=result;
  item.threeMF=true;
 }catch(error){
  build.signal.throwIfAborted();
  clearSTL(item);
  item.stlError=exportErrorMessage(error.message);
 }
}
async function generateAllSTLs(){
 if(busy)return;
 const ready=items.filter(item=>item.svg&&!item.traceStale);
 if(!ready.length)return;
 busy=true;
 const build=window.startMakerBuild('Checking build settings…',$('notice'));
 render();
 try{
  if(!await checkProcessingAccess(ready.length,build.signal))return;
  build.signal.throwIfAborted();
  const settings=stlSettings();
  for(const [index,item] of ready.entries()){
   build.signal.throwIfAborted();
   build.update('Building 3D model '+(index+1)+' of '+ready.length+'…');
   await generateItemSTL(item,settings,build);
   render();
  }
  const failures=ready.filter(item=>item.stlError);
  $('notice').textContent=failures.length?failures.map(item=>item.file.name+': '+item.stlError).join(' | '):
   '3D models ready: '+settings.baseMM+' mm base + '+settings.topMM+' mm raised image.';
 }catch(error){
  $('notice').textContent=error.message;
 }finally{
  const restoreFocus=build.finish();
  busy=false;
  render();
  if(restoreFocus)$('buildSTL').focus({preventScroll:true});
 }
}
$('buildSTL').onclick=generateAllSTLs;
window.prepareFreeSTL=async(selected=items)=>{
 if(busy)throw Error('Wait for the current build to finish.');
 const ready=selected.filter(item=>item.stl&&!item.traceStale);
 if(!ready.length)throw Error('Build your coaster first, then download the free STL parts ZIP.');
 busy=true;render();$('notice').textContent='Packing free STL parts ZIP…';
 try{const bytes=await packInWorker('partsBatch',{items:ready.map(projectGeometry)});return {url:URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),name:ready.length===1?ready[0].outname.replace(/\.svg$/,'-stl-parts.zip'):'coasterprint-stl-parts.zip'};}
 finally{busy=false;render();}
};
$('downloadSTL').onclick=()=>void window.freeSTLDownload();
for(const id of ['modelWidth','baseHeight','topHeight'])$(id).addEventListener('input',()=>{for(const item of items)clearSTL(item);render();$('notice').textContent='3D dimensions changed. Click Build / rebuild STL to apply.';});

$('download3MF').onclick=()=>void downloadProject(items.filter(item=>item.stl&&!item.traceStale));
