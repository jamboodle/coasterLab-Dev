import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
test('export quotes do not spend; one debit survives retries and database restart',()=>{
 const folder=mkdtempSync(join(tmpdir(),'coasterprint-export-'));let ledger;
 try{
  ledger=new Ledger(join(folder,'ledger.sqlite'));const a=ledger.createAccount();ledger.grantTestCredits(a.id,3);
  assert.deepEqual(ledger.exportQuote(a.id,'a'.repeat(64),2),{cost:2,balance:3,remaining:1,retry:false});assert.equal(ledger.balance(a.id),3);
  assert.equal(ledger.debitExport(a.id,'a'.repeat(64),2).cost,2);
  ledger.close();ledger=new Ledger(join(folder,'ledger.sqlite'));
  assert.deepEqual(ledger.debitExport(a.id,'a'.repeat(64),2),{cost:0,balance:1,remaining:1,retry:true});
  assert.equal(ledger.debitExport(a.id,'a'.repeat(64),1).status,409);
  assert.equal(ledger.debitExport(a.id,'b'.repeat(64),2).status,402);
  assert.equal(ledger.balance(a.id),1);assert.equal(ledger.activity(a.id).filter(e=>e.kind==='export_trial').length,1);
 }finally{ledger?.close();rmSync(folder,{recursive:true,force:true});}
});
test('export HTTP trial validates requests, isolates accounts and prevents concurrent overspending',async()=>{
 const ledger=new Ledger(':memory:');const a=ledger.createAccount(),b=ledger.createAccount();ledger.grantTestCredits(a.id,3);let origin;
 const server=createServer((req,res)=>handler({ledger,origin,secureExports:false,exportCreditTrial:true})(req,res));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const headers={Origin:origin,Authorization:'Bearer '+a.token};
 const post=(path,body,override={})=>fetch(origin+path,{method:'POST',headers:{...headers,...override},body:JSON.stringify(body)});
 try{
  assert.equal((await post('/api/export-debit',{fingerprint:'a'.repeat(64),count:1},{Origin:'https://other.example'})).status,403);
  for(const count of [0,11,1.5,'1'])assert.equal((await post('/api/export-debit',{fingerprint:'a'.repeat(64),count})).status,400);
  assert.equal((await post('/api/export-debit',{fingerprint:'bad',count:1})).status,400);
  assert.equal((await post('/api/export-debit',{fingerprint:'a'.repeat(64),count:1},{Authorization:''})).status,401);
  const replies=await Promise.all(['a','b','c','d','e'].map(char=>post('/api/export-debit',{fingerprint:char.repeat(64),count:1})));
  assert.equal(replies.filter(r=>r.status===200).length,3);assert.equal(replies.filter(r=>r.status===402).length,2);
  assert.equal(ledger.balance(a.id),0);
  assert.equal((await post('/api/export-debit',{fingerprint:'a'.repeat(64),count:1},{Authorization:'Bearer '+b.token})).status,402);
  assert.equal(ledger.balance(b.id),0);
 }finally{await new Promise(r=>server.close(r));ledger.close();}
});
test('export accounting routes are disabled by default',async()=>{
 const ledger=new Ledger(':memory:');const a=ledger.createAccount();let origin;
 const server=createServer((req,res)=>handler({ledger,origin,secureExports:false})(req,res));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await (await fetch(origin+'/api/config')).json()).exportCreditTrial,false);
  const response=await fetch(origin+'/api/export-debit',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+a.token},body:JSON.stringify({fingerprint:'a'.repeat(64),count:1})});
  assert.equal(response.status,404);assert.equal(ledger.balance(a.id),0);
 }finally{await new Promise(r=>server.close(r));ledger.close();}
});
