// Free STL archive encoding. 3MF assembly runs only on the server.
function partsArchive(item,result){if(!result?.base || !Array.isArray(result.parts))throw Error('Your model is not ready. Rebuild the coaster before downloading.');const files={};const baseName='base-'+result.baseMM+'mm.stl';files[baseName]=new Uint8Array(result.base.buffer);const colors=result.parts.map(part=>{const rgb=(part.fill.match(/[\d.]+/g)||[]).slice(0,3).map(Number);const hex=rgb.length===3?'#'+rgb.map(n=>Math.round(n).toString(16).padStart(2,'0')).join(''):part.fill;const name='image-color-'+String(part.index).padStart(2,'0')+'-'+hex.replace('#','')+'.stl';files[name]=new Uint8Array(part.buffer);return {file:name,svgColor:part.fill,hex,zStartMM:result.baseMM,heightMM:result.topMM};});files['colors.json']=fflate.strToU8(JSON.stringify({units:'mm',dimensions:result.dimensions,base:{file:baseName,zStartMM:0,heightMM:result.baseMM},colors},null,2));files['IMPORT-INTO-BAMBU.txt']=fflate.strToU8('COASTERPRINT — ALIGNED PRINT PARTS\n\nExtract this ZIP. Select the base STL and ALL image-color STL files, then drag them into Bambu Studio together. When asked, load them as a SINGLE object with multiple parts. This preserves the shared coordinates and the raised layer height. Do not import or auto-arrange each file separately: the slicer may drop each part onto the plate.\n\nAssign a filament to the base and each image color part. colors.json lists the SVG colors. STL itself stores geometry, not colors.\n\nBase: '+result.baseMM+' mm, Z=0 to '+result.baseMM+'. Raised image: '+result.topMM+' mm, Z='+result.baseMM+' to '+(result.baseMM+result.topMM)+'. Width: '+result.widthMM+' mm.\n\nEach color has its own STL part. Assign filaments by part rather than using the fill-paint tool.\n');return fflate.zipSync(files,{level:6});}

function makePartsBatch(items){
 if(items.length===1)return partsArchive(items[0],items[0].stl);
 const files={};
 for(let index=0;index<items.length;index++){
  const item=items[index],name=String(item.file.name).replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]/gi,'_').slice(0,80)||'coaster';
  for(const [path,bytes] of Object.entries(fflate.unzipSync(partsArchive(item,item.stl))))files[String(index+1).padStart(2,'0')+'-'+name+'/'+path]=bytes;
 }
 files['START-HERE.txt']=fflate.strToU8('COASTERPRINT — FREE STL PARTS\n\nExtract this ZIP. Each coaster has its own folder. For each coaster, select its base and all image-color STL files together. In Bambu Studio, import as one object with multiple parts. Assign a filament to each part. Do not import parts individually or auto-arrange them. Repeat for the other coaster folders.\n');
 return fflate.zipSync(files,{level:6});
}

function prepareUpload(items,template,format){
 const base64=buffer=>{const bytes=new Uint8Array(buffer);let text='';for(let offset=0;offset<bytes.length;offset+=32768)text+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(text);};
 return JSON.stringify({format,template,items:items.map(item=>({file:{name:item.file.name},stl:{base:{buffer:base64(item.stl.base.buffer)},parts:item.stl.parts.map(part=>({index:part.index,fill:part.fill,buffer:base64(part.buffer)})),baseMM:item.stl.baseMM,topMM:item.stl.topMM,baseFill:item.stl.baseFill}}))});
}
