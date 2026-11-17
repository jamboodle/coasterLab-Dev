importScripts('vendor/fflate.js','export-codec.68d94e592daf.js');
onmessage=({data})=>{
 try{
  if(data.protocol!==2)throw Error('Export scripts are out of date. Reload this page and try again.');
  if(data.action==='upload'){postMessage({protocol:2,payload:prepareUpload(data.items,data.template,data.format)});return;}
  let bytes;
  if(data.action==='partsBatch')bytes=makePartsBatch(data.items);
  else if(data.action==='parts')bytes=partsArchive(data.item,data.result);
  else throw Error('Export scripts are out of date. Reload this page and try again.');
  postMessage({protocol:2,bytes},[bytes.buffer]);
 }catch(error){postMessage({protocol:2,error:error.message || 'File packing failed'});}
};
