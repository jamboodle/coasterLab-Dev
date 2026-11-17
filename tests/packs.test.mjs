import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';

test('three authoritative packs, independent checkout references, snapshot pricing and correct fulfillment',async()=>{
 const ledger=new Ledger(':memory:'),account=ledger.createAccount();let origin,calls=0;const forms=[];
 ledger.db.prepare('INSERT INTO settings VALUES (?,?)').run('billingEnabled','true');
 const server=createServer((req,res)=>handler({ledger,origin,secretKey:'sk_test_example',webhookSecret:'whsec_example',fetchImpl:async(_url,options)=>{forms.push(options.body);calls++;return Response.json({id:'cs_pack_'+options.headers['Idempotency-Key'],url:'https://checkout.stripe.com/fixture'});}})(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const checkout=(pack,key,extra={})=>fetch(origin+'/api/checkout',{method:'POST',headers:{Authorization:'Bearer '+account.token,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({pack,...extra})});
 try{
  const config=await (await fetch(origin+'/api/config')).json();assert.deepEqual(config.packs.map(({id,amount,credits})=>({id,amount,credits})),[{id:'starter',amount:500,credits:10},{id:'standard',amount:1000,credits:50},{id:'large',amount:1500,credits:100}]);
  for(const [pack,amount,credits] of [['standard',1000,50],['large',1500,100]]){
   const key='pack-request-'+pack;assert.equal((await checkout(pack,key,{amount:1,credits:9999})).status,200);
   assert.equal(forms.at(-1).get('line_items[0][price_data][unit_amount]'),String(amount));assert.match(forms.at(-1).get('line_items[0][price_data][product_data][name]'),new RegExp(credits+' export credits'));assert.equal(new URL(forms.at(-1).get('success_url')).searchParams.get('pack'),pack);
   const order=ledger.db.prepare('SELECT * FROM orders WHERE request_key=?').get(key);assert.equal(order.credits,credits);
   const event={id:'evt_'+pack,type:'checkout.session.completed',livemode:false,data:{object:{id:order.session,livemode:false,payment_status:'paid',mode:'payment',amount_total:amount,currency:'usd'}}};
   const wrong=structuredClone(event);wrong.data.object.amount_total=500;assert.equal(ledger.creditPayment(wrong),false);assert.equal(ledger.creditPayment(event),true);assert.equal(ledger.creditPayment(event),false);
  }
  assert.equal(ledger.balance(account.id),150);
  const before=calls;assert.equal((await checkout('large','pack-request-standard')).status,409);assert.equal((await checkout('unknown','pack-invalid-reference')).status,400);assert.equal(calls,before);
  assert.equal((await checkout('standard','pack-snapshot-reference')).status,200);
  ledger.db.prepare('INSERT INTO settings VALUES (?,?)').run('additionalPacks',JSON.stringify([{id:'standard',amount:1200,credits:60},{id:'large',amount:1800,credits:120}]));
  assert.equal((await checkout('standard','pack-snapshot-reference')).status,200);assert.equal(forms.at(-1).get('line_items[0][price_data][unit_amount]'),'1000');
  assert.equal((await checkout('standard','pack-new-price-reference')).status,200);assert.equal(forms.at(-1).get('line_items[0][price_data][unit_amount]'),'1200');
 }finally{await new Promise(resolve=>server.close(resolve));ledger.close();}
});

test('admin validates both additional packs and publishes saved prices',async()=>{
 const ledger=new Ledger(':memory:');let origin;const admin=ledger.registerIdentity('admin@example.com','salt','digest');ledger.makeAdmin('admin@example.com');const cookie='cl_session='+ledger.createSession(admin);
 const server=createServer((req,res)=>handler({ledger,origin,customerAccounts:true})(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const save=additionalPacks=>fetch(origin+'/api/admin/settings',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({additionalPacks})});
 try{
  for(const packs of [null,[],[{id:'standard',amount:1000,credits:50}],[{id:'standard',amount:-1,credits:50},{id:'large',amount:1500,credits:100}],[{id:'wrong',amount:1000,credits:50},{id:'large',amount:1500,credits:100}]])assert.equal((await save(packs)).status,400);
  const packs=[{id:'standard',amount:1100,credits:55},{id:'large',amount:1600,credits:110}];assert.equal((await save(packs)).status,200);
  assert.deepEqual((await (await fetch(origin+'/api/config')).json()).packs.slice(1),packs.map(pack=>({...pack,currency:'usd'})));
 }finally{await new Promise(resolve=>server.close(resolve));ledger.close();}
});
