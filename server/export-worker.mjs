import {parentPort,workerData} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {makeBatch3MF} from './project-codec.mjs';
const fflate=createRequire(import.meta.url)('../dist/vendor/fflate.js');
function validate(payload){
 if(!payload || !['project','individual'].includes(payload.format) || !Array.isArray(payload.items)||payload.items.length<1||payload.items.length>6)throw Error('Choose 1 to 6 completed coasters.');
 const template=payload.template,config=template?.config;
 if(!config||typeof config!=='object'||Array.isArray(config)||JSON.stringify(config).length>2000000)throw Error('Invalid printer settings.');
 const nozzles=config.nozzle_diameter;if(!Array.isArray(nozzles)||nozzles.length<1||nozzles.length>4||nozzles.some(n=>!Number.isFinite(+n)||+n<.1||+n>2))throw Error('Invalid nozzle settings.');
 const points=config.printable_area?.map(point=>typeof point==='string'?point.split('x').map(Number):[]);
 if(!Array.isArray(points)||points.length!==4||points.some(p=>p.length!==2||p.some(n=>!Number.isFinite(n)||Math.abs(n)>2000)))throw Error('Invalid build plate.');
 const xs=[...new Set(points.map(p=>p[0]))],ys=[...new Set(points.map(p=>p[1]))];
 if(xs.length!==2||ys.length!==2||new Set(points.map(p=>p.join(','))).size!==4)throw Error('Use a rectangular build plate.');
 const width=Math.max(...xs)-Math.min(...xs),depth=Math.max(...ys)-Math.min(...ys);if(width<10||depth<10||width>1000||depth>1000)throw Error('Invalid build plate size.');
 for(const key of Object.keys(config))if(/^(print_host$|printhost_|host_type$|device_id$|device_name$|access_code$|api_key$|serial$|cloud_user|user_id$|printer_ip$|printer_sn$)/i.test(key))delete config[key];
 const cleanTemplate={config,width,depth,minX:Math.min(...xs),minY:Math.min(...ys),printer:String(config.printer_model||config.printer_settings_id||'Bambu printer').slice(0,160)};
 let totalTriangles=0;
 function color(value){if(typeof value!=='string'||!(/^[#][a-f0-9]{6}$/i.test(value)||/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(value)))throw Error('Invalid model color.');if(value[0]!=='#'&&value.match(/\d+/g).some(n=>+n>255))throw Error('Invalid model color.');return value;}
 const items=payload.items.map((item,index)=>{
  if(typeof item?.file?.name!=='string'||item.file.name.length>200||/[\x00-\x1f\x7f]/.test(item.file.name))throw Error('Invalid coaster name.');
  const model=item.stl;if(!model||!Array.isArray(model.parts)||model.parts.length<1||model.parts.length>32)throw Error('Invalid color parts.');
  if(!Number.isFinite(model.baseMM)||model.baseMM<.1||model.baseMM>20||!Number.isFinite(model.topMM)||model.topMM<.1||model.topMM>10)throw Error('Invalid layer heights.');
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  function mesh(encoded,zMin,zMax){
   if(typeof encoded!=='string'||encoded.length>28000000||(encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)))throw Error('Invalid STL geometry.');
   const bytes=Buffer.from(encoded,'base64');if(bytes.length<134)throw Error('Empty STL geometry.');const count=bytes.readUInt32LE(80);totalTriangles+=count;
   if(count<1||bytes.length!==84+count*50||totalTriangles>400000)throw Error('Model is too complex. Use fewer colors or smoother tracing.');
   for(let triangle=0;triangle<count;triangle++)for(let vertex=0;vertex<3;vertex++)for(let axis=0;axis<3;axis++){
    const value=bytes.readFloatLE(84+triangle*50+12+vertex*12+axis*4);if(!Number.isFinite(value)||Math.abs(value)>1000||(axis===2&&(value<zMin-.02||value>zMax+.02)))throw Error('Invalid model coordinates.');min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);
   }
   return {buffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),triangles:count};
  }
  const base=mesh(model.base?.buffer,0,model.baseMM),dimensions={min:[...min],max:[max[0],max[1],model.baseMM+model.topMM]},indices=new Set();
  const parts=model.parts.map(part=>{if(!Number.isInteger(part.index)||part.index<1||part.index>32||indices.has(part.index))throw Error('Invalid color part index.');indices.add(part.index);return {...mesh(part.buffer,model.baseMM,model.baseMM+model.topMM),fill:color(part.fill),index:part.index};});
  const widthMM=max[0]-min[0];if(widthMM<.9||widthMM>500.1||max[1]-min[1]>500.1)throw Error('Invalid coaster dimensions.');
  return {file:{name:item.file.name || 'coaster-'+(index+1)},stl:{base,parts,dimensions,baseMM:model.baseMM,topMM:model.topMM,widthMM,baseFill:color(model.baseFill || parts[0].fill)}};
 });
 return {items,template:cleanTemplate,format:payload.format};
}
try{
 const validated=validate(workerData);
 const fingerprint=createHash('sha256').update('server-3mf-v1\0').update(JSON.stringify(workerData)).digest('hex');
 let bytes;if(validated.format==='project')bytes=makeBatch3MF(validated.items,validated.template);
 else{const files={};validated.items.forEach((item,index)=>{const name=item.file.name.replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]/gi,'_').slice(0,80)||'coaster';files[String(index+1).padStart(2,'0')+'-'+name+'.3mf']=makeBatch3MF([item],validated.template);});bytes=fflate.zipSync(files,{level:6});}
 if(bytes.byteLength>32000000)throw Error('Export is too large. Use a smaller batch.');
 parentPort.postMessage({bytes,fingerprint,count:validated.items.length,format:validated.format},[bytes.buffer]);
}catch(error){parentPort.postMessage({error:error.message || 'Could not prepare this export.'});}
