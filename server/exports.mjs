import {Worker} from 'node:worker_threads';
const running=new WeakMap(),downloads=new WeakMap();
export async function exportRequest({req,res,path,send,ledger,account,origin,billingEnabled}){
 if(req.method==='POST'&&req.headers.origin!==origin)return send(403,{error:'Origin rejected'});
 ledger.pruneExports();
 const match=path.match(/^\/api\/exports\/([a-f0-9]{32})(?:\/(authorize|file))?$/);
 if(req.method==='POST'&&path==='/api/exports'){
  let active=running.get(ledger);if(!active){active=new Set();running.set(ledger,active);}
  if(active.size>=2||active.has(account))return send(503,{error:'Export service is busy. Wait a moment and retry.'});
  if(!ledger.allowAuth('export-build:'+account))return send(429,{error:'Too many export preparations. Try again in 15 minutes.'});
  active.add(account);
  try{
   const chunks=[];let size=0;req.setTimeout(30000,()=>req.destroy());for await(const chunk of req){size+=chunk.length;if(size>32000000)return send(413,{error:'Model upload is too large. Use a smaller batch.'});chunks.push(chunk);}
   req.setTimeout(0);let payload;try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{error:'Invalid model upload.'});}
   const result=await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./export-worker.mjs',import.meta.url),{workerData:payload,resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32}});
    const timer=setTimeout(()=>finish(Error('Export preparation timed out. Use a smaller batch.')),60000);let finished=false;
    function finish(error,value){if(finished)return;finished=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(value);}
    worker.once('message',message=>message.error?finish(Error(message.error)):finish(null,message));worker.once('error',()=>finish(Error('Export preparation failed. Try a smaller batch.')));worker.once('exit',code=>{if(!finished)finish(Error('Export preparation failed. Try a smaller batch.'));});
   });
   const id=ledger.storeExport(account,{...result,bytes:Buffer.from(result.bytes)});return send(201,{id,...quote(ledger,account,id,billingEnabled)});
  }catch(error){return send(400,{error:error.message});}finally{active.delete(account);}
 }
 if(!match)return send(404,{error:'Not found'});
 const id=match[1],action=match[2],job=ledger.exportJob(account,id);if(!job)return send(404,{error:'Export expired or not found. Prepare it again.'});
 if(req.method==='GET'&&!action)return send(200,{id,...quote(ledger,account,id,billingEnabled)});
 if(req.method==='POST'&&action==='authorize'){
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>1024)return send(413,{error:'Payload too large'});}
  let body;try{body=JSON.parse(raw);}catch{return send(400,{error:'Invalid request'});}
  if(!Number.isInteger(body?.expectedCost)||body.expectedCost<0||body.expectedCost>6)return send(400,{error:'Invalid export confirmation.'});
  const result=ledger.releaseExport(account,id,billingEnabled,body.expectedCost);if(result.error)return send(result.status,{error:result.error});return send(200,{...result,url:'/api/exports/'+id+'/file'});
 }
 if(['GET','HEAD'].includes(req.method)&&action==='file'){
  if(!job.released)return send(403,{error:'Confirm the export before downloading.'});
  let transfers=downloads.get(ledger);if(!transfers){transfers=new Map();downloads.set(ledger,transfers);}const total=[...transfers.values()].reduce((sum,value)=>sum+value,0);
  if(total>=4||(transfers.get(account)||0)>=2)return send(503,{error:'Another download is still in progress. Wait a moment and retry.'});
  const bytes=ledger.exportBytes(account,id);if(!bytes)return send(404,{error:'Export expired. Prepare it again.'});
  transfers.set(account,(transfers.get(account)||0)+1);let finished=false;const finish=()=>{if(finished)return;finished=true;const count=(transfers.get(account)||1)-1;if(count)transfers.set(account,count);else transfers.delete(account);};res.once('finish',finish);res.once('close',finish);
  const name=job.format==='individual'?'coasterprint-individual-models.zip':job.count>1?'coasterprint-'+job.count+'-plate-project.3mf':'coasterprint-coaster.3mf';
  res.writeHead(200,{'Content-Type':job.format==='individual'?'application/zip':'model/3mf','Content-Length':bytes.length,'Content-Disposition':'attachment; filename="'+name+'"','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});return res.end(req.method==='HEAD'?undefined:bytes);
 }
 return send(405,{error:'Method not allowed'});
}
function quote(ledger,account,id,billingEnabled){const job=ledger.exportJob(account,id),balance=ledger.balance(account);const result=!job.released&&billingEnabled?ledger.exportQuote(account,job.fingerprint,job.count):{cost:0,balance,remaining:balance,retry:Boolean(job.released)};return {...result,count:job.count,format:job.format,expires:job.expires,released:Boolean(job.released)};}
