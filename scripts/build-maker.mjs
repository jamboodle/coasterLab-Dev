import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=name=>readFileSync(root+name,'utf8');
const manifest=JSON.parse(read('dist/asset-manifest.json'));
const names=Object.keys(manifest.scripts);
const expression=new RegExp('(?<![\\w.-])('+names.map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')(?![\\w.-])','g');
const outputs=new Map(),building=new Set();
function build(name){
 if(outputs.has(name))return outputs.get(name).filename;
 if(building.has(name))throw Error('Cyclic script references: '+name);
 building.add(name);
 const source=read('src/maker/'+name);
 const code=source.replace(expression,dependency=>build(dependency));
 const digest=createHash('sha256').update(code).digest('hex').slice(0,12);
 const filename=name.replace(/\.js$/,'.'+digest+'.js');
 outputs.set(name,{filename,code});building.delete(name);return filename;
}
for(const name of names)build(name);
let html=read('dist/index.html');
for(const [name,old] of Object.entries(manifest.scripts))html=html.replaceAll(old,outputs.get(name).filename);
const next={...manifest,scripts:Object.fromEntries(names.map(name=>[name,outputs.get(name).filename]))};
const packingWorker=`const MAX_BATCH_IMAGES=6;\nimportScripts('vendor/fflate.js','${outputs.get('filament-palette.js').filename}','${outputs.get('export-codec.js').filename}');\nonmessage=({data})=>{try{const bytes=data.action==='project'?makeBatch3MF(data.items,data.template):data.action==='partsBatch'?makePartsBatch(data.items):partsArchive(data.item,data.result);postMessage({bytes},[bytes.buffer]);}catch(error){postMessage({error:error.message || 'File packing failed'});}};\n`;
const files=[...outputs.values()].map(({filename,code})=>['dist/'+filename,code]);
files.push(['dist/export-packing-worker.js',packingWorker],['dist/index.html',html],['dist/asset-manifest.json',JSON.stringify(next,null,2)+'\n']);
for(const [path,content] of files){
 if(process.argv.includes('--check')){
  if(!existsSync(root+path) || read(path)!==content)throw Error('Maker assets need rebuilding: '+path);
 }else writeFileSync(root+path,content);
}
console.log(process.argv.includes('--check')?'PASS maker assets match source':'Built maker scripts and current entry point; historical assets retained');
