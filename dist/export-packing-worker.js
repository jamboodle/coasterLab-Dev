const MAX_BATCH_IMAGES=10;
importScripts('vendor/fflate.js','filament-palette.f9e95eb63a55.js','export-codec.8bef0f923ccb.js');
onmessage=({data})=>{try{const bytes=data.action==='project'?makeBatch3MF(data.items,data.template):partsArchive(data.item,data.result);postMessage({bytes},[bytes.buffer]);}catch(error){postMessage({error:error.message || 'File packing failed'});}};
