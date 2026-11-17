let batchTemplate=null,batchTemplateRead=0;
function parseBambuTemplate(bytes,name){
 const files=fflate.unzipSync(bytes,{filter:file=>file.name==='Metadata/project_settings.config'&&file.originalSize<2000000});
 const bytesConfig=files['Metadata/project_settings.config'];if(!bytesConfig)throw Error('Choose a Bambu project saved with printer settings. A model-only 3MF cannot supply a printer profile.');
 const config=JSON.parse(fflate.strFromU8(bytesConfig));const nozzles=config.nozzle_diameter;if(!Array.isArray(nozzles)||!nozzles.length||nozzles.some(n=>!Number.isFinite(+n)||+n<=0))throw Error('The template has no supported nozzle configuration. Save a project from Bambu Studio with your printer selected.');
 const points=(config.printable_area||[]).map(p=>String(p).split('x').map(Number));if(points.length!==4||points.some(p=>p.length!==2||p.some(n=>!Number.isFinite(n))))throw Error('The template needs a rectangular Bambu build plate.');const xs=[...new Set(points.map(p=>p[0]))],ys=[...new Set(points.map(p=>p[1]))];if(xs.length!==2||ys.length!==2)throw Error('Only rectangular plate templates are supported.');
 const minX=Math.min(...xs),minY=Math.min(...ys),width=Math.max(...xs)-minX,depth=Math.max(...ys)-minY;if(width<=0||depth<=0)throw Error('The template has invalid plate dimensions.');
 // Printer connection information and author identities are not needed in a printable project.
 for(const key of Object.keys(config))if(/^(print_host$|printhost_|host_type$|device_id$|device_name$|access_code$|api_key$|serial$|cloud_user|user_id$|printer_ip$|printer_sn$)/i.test(key))delete config[key];
 return {name,config,width,depth,minX,minY,printer:String(config.printer_model||config.printer_settings_id||'Bambu printer'),nozzles:nozzles.map(Number),colors:Array.isArray(config.filament_colour)?config.filament_colour:[]};
}
function updateBatchControls(){const ready=items.filter(i=>i.stl).length;$('downloadBatch3MF').disabled=busy||ready<2||!batchTemplate;$('downloadIndividualZIP').disabled=busy||ready<2;$('batchTemplate').disabled=busy;$('batchDefault').disabled=busy;$('batchActiveProfile').textContent=batchTemplate?'Batch profile: '+batchTemplate.printer+' · '+batchTemplate.nozzles.join(' / ')+' mm nozzle':'Batch profile is not loaded. Choose a template below.';$('batchCount').textContent=ready?ready+' converted coaster'+(ready===1?'':'s')+' ready. One coaster per plate.':'Convert at least two coasters to create a multi-plate project.';}
async function downloadProject(selected,format='project'){
 if(!selected.length||busy)return;
 if(!batchTemplate)await batchProfilePromise;if(!batchTemplate){$('notice').textContent='Choose a Bambu printer profile first.';return;}
 const template={config:JSON.parse(JSON.stringify(batchTemplate.config))};
 return window.creditTrialDownload(()=>packInWorker('upload',{items:selected.map(projectGeometry),template,format}));
}
async function downloadBatchProject(){return downloadProject(items.filter(item=>item.stl&&!item.traceStale));}
$('batchTemplate').onchange=async e=>{const file=e.target.files[0];if(!file)return;const token=++batchTemplateRead;batchTemplate=null;updateBatchControls();try{if(file.size>64*1024*1024)throw Error('Use an unsliced Bambu project template smaller than 64 MB.');const bytes=new Uint8Array(await file.arrayBuffer());if(token!==batchTemplateRead)return;batchTemplate=parseBambuTemplate(bytes,file.name);$('batchProfile').textContent=batchTemplate.printer+' · '+batchTemplate.nozzles.join(' / ')+' mm nozzle · '+batchTemplate.width+' × '+batchTemplate.depth+' mm plate';}catch(e){if(token===batchTemplateRead)$('batchProfile').textContent=e.message;}refreshColorProjects();updateBatchControls();};
$('downloadBatch3MF').onclick=downloadBatchProject;
$('downloadIndividualZIP').onclick=()=>void downloadProject(items.filter(item=>item.stl&&!item.traceStale),'individual');

async function useDefaultBatchProfile(){const token=++batchTemplateRead;batchTemplate=null;updateBatchControls();$('batchProfile').textContent='Loading P1S / 0.4 mm starter profile…';try{const response=await fetch('presets/bambu-p1s-04.json');if(!response.ok)throw Error('Default profile could not load. Choose your own Bambu project template.');const config=await response.json();if(token!==batchTemplateRead)return;const archive=fflate.zipSync({'Metadata/project_settings.config':fflate.strToU8(JSON.stringify(config))});batchTemplate=parseBambuTemplate(archive,'CoasterPrint P1S / 0.4 mm starter');$('batchTemplate').value='';$('batchProfile').textContent='Default: '+batchTemplate.printer+' · 0.4 mm nozzle · '+batchTemplate.width+' × '+batchTemplate.depth+' mm plate';}catch(e){if(token===batchTemplateRead)$('batchProfile').textContent=e.message;}refreshColorProjects();updateBatchControls();}
$('batchDefault').onclick=useDefaultBatchProfile;let batchProfilePromise=useDefaultBatchProfile();

function refreshColorProjects(){render();}
