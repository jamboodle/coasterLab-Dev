import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
import {modelPayload} from './export-fixture.mjs';
const {unzipSync}=createRequire(import.meta.url)('../dist/vendor/fflate.js');
async function fixture(run){const ledger=new Ledger(':memory:'),a=ledger.createAccount(),b=ledger.createAccount();ledger.grantTestCredits(a.id,6);ledger.saveSettings(a.id,{billingEnabled:true});let origin;const server=createServer((req,res)=>handler({ledger,origin,customerAccounts:true})(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const call=(path,{body,token=a.token,requestOrigin=origin}={})=>fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:requestOrigin,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});try{await run({ledger,a,b,call,origin});}finally{await new Promise(resolve=>server.close(resolve));ledger.close();}}

test('server builds private files, derives cost from models, enforces owner/release, and debits exactly once',()=>fixture(async({ledger,a,b,call})=>{
 assert.equal((await call('/api/exports',{body:modelPayload(),token:''})).status,401);assert.equal((await call('/api/exports',{body:modelPayload(),requestOrigin:'https://other.example'})).status,403);
 const created=await call('/api/exports',{body:{...modelPayload(2),count:1,fingerprint:'a'.repeat(64)}});assert.equal(created.status,201);const job=await created.json();assert.equal(job.count,2);assert.equal(job.cost,2);assert.equal(ledger.balance(a.id),6);
 const file='/api/exports/'+job.id+'/file';assert.equal((await call(file)).status,403);assert.equal((await call(file,{token:b.token})).status,404);assert.equal((await call(file,{token:''})).status,401);
 const replies=await Promise.all([call('/api/exports/'+job.id+'/authorize',{body:{expectedCost:2}}),call('/api/exports/'+job.id+'/authorize',{body:{expectedCost:2}})]);assert.ok(replies.every(response=>response.status===200));assert.equal(ledger.balance(a.id),4);
 for(let i=0;i<2;i++){const response=await call(file);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);assert.match(response.headers.get('cache-control'),/no-store/);const files=unzipSync(new Uint8Array(await response.arrayBuffer()));assert.equal(JSON.parse(Buffer.from(files['Metadata/coasterprint-plates.json']).toString()).plates.length,2);}
 assert.equal(ledger.balance(a.id),4);const duplicate=await (await call('/api/exports',{body:{...modelPayload(2),count:1,fingerprint:'a'.repeat(64)}})).json();assert.equal(duplicate.id,job.id);assert.equal(duplicate.cost,0);
 assert.equal((await call('/api/export-debit',{body:{fingerprint:'f'.repeat(64),count:1}})).status,410);
}));

test('insufficient balance and changed billing cannot release files; expiry is owner-bound and paid regeneration is free',()=>fixture(async({ledger,a,b,call})=>{
 const job=await (await call('/api/exports',{body:modelPayload(2)})).json();ledger.saveSettings(a.id,{billingEnabled:false});assert.equal((await call('/api/exports/'+job.id+'/authorize',{body:{expectedCost:2}})).status,409);assert.equal(ledger.balance(a.id),6);
 ledger.saveSettings(a.id,{billingEnabled:true});ledger.db.prepare("INSERT INTO entries VALUES ('empty',?,-6,'test')").run(a.id);
 assert.equal((await call('/api/exports/'+job.id+'/authorize',{body:{expectedCost:2}})).status,402);assert.equal((await call('/api/exports/'+job.id+'/file')).status,403);assert.equal((await call('/api/exports/'+job.id+'/authorize',{body:{expectedCost:2},token:b.token})).status,404);
 ledger.grantTestCredits(a.id,2);assert.equal((await call('/api/exports/'+job.id+'/authorize',{body:{expectedCost:2}})).status,200);assert.equal(ledger.balance(a.id),0);ledger.db.prepare('UPDATE export_jobs SET expires=0 WHERE id=?').run(job.id);assert.equal((await call('/api/exports/'+job.id+'/file')).status,404);
 const regenerated=await (await call('/api/exports',{body:modelPayload(2)})).json();assert.equal(regenerated.cost,0);assert.notEqual(regenerated.id,job.id);assert.equal((await call('/api/exports/'+regenerated.id+'/authorize',{body:{expectedCost:0}})).status,200);assert.equal(ledger.balance(a.id),0);
}));

test('malformed geometry/count/template fails before any debit, and individual ZIP cost follows contained models',()=>fixture(async({ledger,a,call})=>{
 for(const payload of [modelPayload(0),modelPayload(7),{...modelPayload(),format:'unknown'},(()=>{const p=modelPayload();p.items[0].stl.base.buffer='bad';return p;})(),(()=>{const p=modelPayload();p.template.config.printable_area=['bad'];return p;})()])assert.equal((await call('/api/exports',{body:payload})).status,400);
 assert.equal(ledger.balance(a.id),6);const job=await (await call('/api/exports',{body:modelPayload(3,'individual')})).json();assert.equal(job.cost,3);await call('/api/exports/'+job.id+'/authorize',{body:{expectedCost:3}});const response=await call('/api/exports/'+job.id+'/file');const files=unzipSync(new Uint8Array(await response.arrayBuffer()));assert.equal(Object.keys(files).filter(name=>name.endsWith('.3mf')).length,3);assert.equal(ledger.balance(a.id),3);
}));

test('files and download entitlements survive restart, with no second debit',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const directory=mkdtempSync(join(tmpdir(),'coasterprint-private-'));let ledger=new Ledger(join(directory,'credits.sqlite')),origin;
 const a=ledger.createAccount();ledger.grantTestCredits(a.id,2);ledger.saveSettings(a.id,{billingEnabled:true});const server=createServer((req,res)=>handler({ledger,origin,customerAccounts:true})(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const call=(path,body)=>fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 try{const job=await (await call('/api/exports',modelPayload())).json();await call('/api/exports/'+job.id+'/authorize',{expectedCost:1});ledger.close();ledger=new Ledger(join(directory,'credits.sqlite'));assert.equal((await call('/api/exports/'+job.id+'/file')).status,200);assert.equal((await (await call('/api/exports/'+job.id+'/authorize',{expectedCost:1})).json()).cost,0);assert.equal(ledger.balance(a.id),1);}finally{await new Promise(resolve=>server.close(resolve));ledger.close();rmSync(directory,{recursive:true,force:true});}
});

test('historical packaging scripts and archives are retired, including encoded URLs',async()=>{
 const {withStatic}=await import('../server/static.mjs'),{fileURLToPath}=await import('node:url');const server=createServer(withStatic((_req,res)=>{res.writeHead(404);res.end();},fileURLToPath(new URL('../dist/',import.meta.url))));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{for(const path of ['/export-codec.5d7d9167e4eb.js','/%65xport-codec.5d7d9167e4eb.js','/downloads/coasterprint-self-hosted-r27.zip','/downloads/coasterprint-self-hosted-r27%2ezip'])assert.equal((await fetch(origin+path)).status,410);for(const path of ['/coasterprint-r27.html','/coasterprint-r27%2ehtml'])assert.equal((await fetch(origin+path,{redirect:'manual'})).headers.get('location'),'/');assert.equal((await fetch(origin+'/server/project-codec.mjs')).status,404);assert.equal((await fetch(origin+'/downloads/coasterprint-holder-pack.zip')).status,200);}finally{await new Promise(resolve=>server.close(resolve));}
});
