'use strict';
// Separate workers keep ZIP/XML assembly off the UI thread. All geometry stays local.
function packInWorker(action,payload){
 return new Promise((resolve,reject)=>{
  const worker=new Worker('export-packing-worker.js');
  const timer=setTimeout(()=>finish(Error('File packing timed out. Try exporting one coaster at a time.')),180000);
  function finish(error,bytes){clearTimeout(timer);worker.terminate();error?reject(error):resolve(bytes);}
  worker.onmessage=({data})=>data.error?finish(Error(data.error)):finish(null,data.bytes);
  worker.onerror=()=>finish(Error('Could not load the file packing worker. Reload the app and try again.'));
  worker.postMessage({action,...payload});
 });
}
function projectGeometry(item){
 const {base,parts,dimensions,baseMM,topMM,widthMM,baseFill,volume}=item.stl;
 return {file:{name:item.file.name},stl:{base,parts,dimensions,baseMM,topMM,widthMM,baseFill,volume}};
}
function packProject(items,template){return packInWorker('project',{items:items.map(projectGeometry),template});}
function packParts(item,result){return packInWorker('parts',{item:{file:{name:item.file.name}},result:{base:result.base,parts:result.parts,dimensions:result.dimensions,baseMM:result.baseMM,topMM:result.topMM,widthMM:result.widthMM}});}
