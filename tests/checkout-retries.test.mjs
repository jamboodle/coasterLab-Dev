import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
test('checkout attempts survive restart, isolate accounts, expire, and migrate old databases',()=>{
 const dir=mkdtempSync(join(tmpdir(),'coasterlab-orders-'));const path=join(dir,'db.sqlite');let ledger;
 try{
  const old=new DatabaseSync(path);old.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL); CREATE TABLE orders(id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), session TEXT UNIQUE);');old.close();
  ledger=new Ledger(path);const a=ledger.createAccount(),b=ledger.createAccount();
  const order=ledger.checkoutOrder(a.id,'repeatable-request-key',1000);
  assert.equal(ledger.checkoutOrder(a.id,'repeatable-request-key',2000).id,order.id);
  assert.notEqual(ledger.checkoutOrder(b.id,'repeatable-request-key',1000).id,order.id);
  assert.equal(ledger.orderStatus(b.id,order.id),null);
  assert.equal(ledger.orderStatus(a.id,order.id,2000),'pending');
  assert.equal(ledger.orderStatus(a.id,order.id,3601000),'expired');
  ledger.close();ledger=new Ledger(path);
  assert.equal(ledger.checkoutOrder(a.id,'repeatable-request-key',2000).id,order.id);
 }finally{ledger?.close();rmSync(dir,{recursive:true,force:true});}
});
test('checkout timeout retries and concurrent submissions reuse one provider key and one order',async()=>{
 const ledger=new Ledger(':memory:');const account=ledger.createAccount(),other=ledger.createAccount();let origin,calls=0;
 const providerKeys=[];
 const server=createServer((req,res)=>handler({ledger,origin,secretKey:'sk_test_fixture',webhookSecret:'fixture',fetchImpl:async(_url,options)=>{
  calls++;providerKeys.push(options.headers['Idempotency-Key']);
  if(calls===1)throw Error('Simulated lost provider response');
  return Response.json({id:'cs_retry',url:'https://checkout.stripe.com/c/pay/retry'});
 }})(req,res));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const headers={Authorization:'Bearer '+account.token,'Idempotency-Key':'browser-retry-key-123456'};
 const checkout=()=>fetch(origin+'/api/checkout',{method:'POST',headers});
 try{
  assert.equal((await checkout()).status,500);
  const replies=await Promise.all([checkout(),checkout()]);assert.ok(replies.every(r=>r.status===200));
  const [a,b]=await Promise.all(replies.map(r=>r.json()));assert.equal(a.order,b.order);
  assert.equal(new Set(providerKeys).size,1);
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count,1);
  assert.equal(ledger.balance(account.id),0);
  const pending=await fetch(origin+'/api/checkout-status?order='+a.order,{headers});assert.deepEqual(await pending.json(),{status:'pending'});
  assert.equal((await fetch(origin+'/api/checkout-status?order='+a.order,{headers:{Authorization:'Bearer '+other.token}})).status,404);
  assert.equal((await fetch(origin+'/api/checkout',{method:'POST',headers:{...headers,'Idempotency-Key':'bad'}})).status,400);
  ledger.creditPayment({id:'evt_retry',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_retry',livemode:false,mode:'payment',payment_status:'paid',amount_total:500,currency:'usd'}}});
  assert.deepEqual(await (await fetch(origin+'/api/checkout-status?order='+a.order,{headers})).json(),{status:'confirmed'});
  const done=await checkout();assert.equal(done.status,409);assert.equal((await done.json()).code,'checkout_complete');
  const stale=ledger.checkoutOrder(account.id,'expired-browser-key-123',Date.now()-3600001);
  const expired=await fetch(origin+'/api/checkout',{method:'POST',headers:{...headers,'Idempotency-Key':'expired-browser-key-123'}});
  assert.equal(expired.status,409);assert.equal((await expired.json()).code,'checkout_expired');
  assert.equal(ledger.orderStatus(account.id,stale.id),'expired');
  assert.equal(calls,3);assert.equal(ledger.balance(account.id),10);
 }finally{await new Promise(r=>server.close(r));ledger.close();}
});
