import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Ledger} from '../server/ledger.mjs';
import {handler,verifyWebhook} from '../server/app.mjs';
const secret='test-webhook-signing-secret';
function signed(body,time=Math.floor(Date.now()/1000)) {return `t=${time},v1=${createHmac('sha256',secret).update(time+'.'+body).digest('hex')}`;}
function payment(id='evt_1',session='cs_test_1') {return {id,type:'checkout.session.completed',livemode:false,data:{object:{id:session,livemode:false,payment_status:'paid',mode:'payment',amount_total:500,currency:'usd'}}};}
test('webhook signatures require matching raw bytes, valid timestamp, and secret',()=>{
 const body=JSON.stringify(payment());
 assert.ok(verifyWebhook(Buffer.from(body),signed(body),secret));
 assert.equal(verifyWebhook(Buffer.from(body+' '),signed(body),secret),false);
 assert.equal(verifyWebhook(Buffer.from(body),signed(body,1),secret),false);
 assert.equal(verifyWebhook(Buffer.from(body),'t=bad,v1=bad',secret),false);
});
test('ledger persists and credits one purchase once across event types',()=>{
 const dir=mkdtempSync(join(tmpdir(),'coasterprint-ledger-'));let ledger;
 try {
  ledger=new Ledger(join(dir,'credits.sqlite'));const account=ledger.createAccount();
  const order=ledger.createOrder(account.id);ledger.attachSession(order,'cs_test_1');
  assert.equal(ledger.authenticate(account.token),account.id);
  assert.equal(ledger.authenticate('invalid'),undefined);
  assert.equal(ledger.creditPayment(payment()),true);
  assert.equal(ledger.creditPayment(payment()),false);
  const later=payment('evt_2');later.type='checkout.session.async_payment_succeeded';
  assert.equal(ledger.creditPayment(later),false);
  assert.equal(ledger.balance(account.id),10);
  ledger.close();ledger=new Ledger(join(dir,'credits.sqlite'));
  assert.equal(ledger.balance(account.id),10);
 } finally {ledger?.close();rmSync(dir,{recursive:true,force:true});}
});
test('unpaid, wrong-value, live, unknown and canceled purchases never add credits',()=>{
 const ledger=new Ledger(':memory:');ledger.db.prepare('INSERT INTO settings VALUES (?,?)').run('billingEnabled','true');try {
  const a=ledger.createAccount();const order=ledger.createOrder(a.id);ledger.attachSession(order,'cs_test_1');
  for(const change of [{payment_status:'unpaid'},{amount_total:100},{currency:'eur'},{livemode:true}]) {
   const event=payment();Object.assign(event.data.object,change);assert.equal(ledger.creditPayment(event),false);
  }
  const expired=payment();expired.type='checkout.session.expired';assert.equal(ledger.creditPayment(expired),false);
  assert.throws(()=>ledger.creditPayment(payment('evt_unknown','cs_unknown')),/Unknown/);
  assert.equal(ledger.balance(a.id),0);
 }finally{ledger.close();}
});
test('HTTP checkout binds owner to signed payment and isolates balances',async()=>{
 const ledger=new Ledger(':memory:');ledger.db.prepare('INSERT INTO settings VALUES (?,?)').run('billingEnabled','true');const a=ledger.createAccount(),b=ledger.createAccount();
 let providerCalls=0;
 const server=createServer(handler({ledger,origin:'http://localhost:3002',secretKey:'sk_test_example',webhookSecret:secret,fetchImpl:async(url,options)=>{
  providerCalls++;assert.equal(url,'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(options.body.get('line_items[0][price_data][unit_amount]'),'500');
  assert.ok(options.body.get('metadata[order_id]'));
  return Response.json({id:'cs_test_1',url:'https://checkout.stripe.com/c/pay/example'});
 }}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const auth={Authorization:'Bearer '+a.token};
 try {
  assert.equal((await fetch(base+'/api/balance')).status,401);
  assert.equal((await fetch(base+'/api/checkout',{method:'POST',headers:{...auth,Origin:'https://untrusted.example'}})).status,403);
  assert.equal(providerCalls,0);
  assert.equal((await fetch(base+'/api/checkout',{method:'POST',headers:auth})).status,200);
  assert.equal((await (await fetch(base+'/api/balance',{headers:auth})).json()).credits,0);
  const body=JSON.stringify(payment());
  assert.equal((await fetch(base+'/api/webhooks/stripe',{method:'POST',body,headers:{'stripe-signature':'bad'}})).status,400);
  const notifications=await Promise.all(Array.from({length:4},()=>fetch(base+'/api/webhooks/stripe',{method:'POST',body,headers:{'stripe-signature':signed(body)}})));
  assert.ok(notifications.every(r=>r.status===200));
  assert.equal((await (await fetch(base+'/api/balance',{headers:auth})).json()).credits,10);
  assert.equal((await (await fetch(base+'/api/balance',{headers:{Authorization:'Bearer '+b.token}})).json()).credits,0);
 }finally{await new Promise(resolve=>server.close(resolve));ledger.close();}
});
test('checkout is disabled without configuration or with live Stripe keys',async()=>{
 for(const key of [undefined,'sk_live_example']) {
  const ledger=new Ledger(':memory:');ledger.db.prepare('INSERT INTO settings VALUES (?,?)').run('billingEnabled','true');const a=ledger.createAccount();
  const server=createServer(handler({ledger,origin:'http://localhost:3002',secretKey:key,webhookSecret:secret}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/checkout',{method:'POST',headers:{Authorization:'Bearer '+a.token}});assert.equal(response.status,503);}
  finally{await new Promise(r=>server.close(r));ledger.close();}
 }
});
