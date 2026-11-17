const MAX_BATCH_IMAGES=6;
importScripts('vendor/fflate.js','filament-palette.f9e95eb63a55.js','export-codec.5d7d9167e4eb.js');
onmessage=({data})=>{try{const bytes=data.action==='project'?makeBatch3MF(data.items,data.template):data.action==='partsBatch'?makePartsBatch(data.items):partsArchive(data.item,data.result);postMessage({bytes},[bytes.buffer]);}catch(error){postMessage({error:error.message || 'File packing failed'});}};
