import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createServer} from 'node:http';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
const testSecret='whsec_test_fixture',liveSecret='whsec_live_fixture';
async function fixture(run,{origin='https://coasterprint.com',allowed=true}={}){
 const ledger=new Ledger(':memory:'),admin=ledger.registerIdentity('admin@example.com','salt','digest');ledger.makeAdmin('admin@example.com');const cookie='cl_session='+ledger.createSession(admin),runtime={allowed},calls=[];let badMode=false;
 const server=createServer((req,res)=>handler({ledger,origin,customerAccounts:true,allowLivePayments:runtime.allowed,fetchImpl:async(_url,options)=>{calls.push(options);return Response.json({id:'cs_live_'+options.headers['Idempotency-Key'],url:'https://checkout.stripe.com/fixture',livemode:!badMode});}})(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 async function call(path,body,key){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};}
 async function webhook(event,mode='live',secret=liveSecret){const body=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000),signature=`t=${timestamp},v1=${createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex')}`;const response=await fetch(base+'/api/webhooks/stripe'+(mode==='live'?'/live':''),{method:'POST',headers:{'stripe-signature':signature},body});return response.status;}
 try{await run({ledger,admin,runtime,calls,call,webhook,setBadMode:value=>{badMode=value;}});}finally{await new Promise(resolve=>server.close(resolve));ledger.close();}
}
async function configure(call,liveKey='sk_live_fixture'){assert.equal((await call('/api/admin/settings',{secretKey:'sk_test_fixture',webhookSecret:testSecret,liveSecretKey:liveKey,liveWebhookSecret:liveSecret})).status,200);}
function payment(order,id='evt_live'){return {id,type:'checkout.session.completed',livemode:true,data:{object:{id:order.session,livemode:true,payment_status:'paid',mode:'payment',amount_total:order.amount,currency:order.currency,metadata:{order_id:order.id}}}};}

test('live payments default off, require production permission and cannot accept sandbox purchases on production',()=>fixture(async({call,calls})=>{
 let config=await call('/api/admin/settings');assert.equal(config.data.livePaymentsEnabled,false);assert.equal(config.data.paymentMode,'test');assert.equal(config.data.testPaymentsAllowed,false);
 await configure(call);assert.equal((await call('/api/config')).data.paymentsEnabled,false);assert.equal((await call('/api/checkout',{pack:'starter',mode:'live'},'live-request-default-off')).status,503);
 assert.equal((await call('/api/admin/settings',{billingEnabled:true})).status,200);assert.equal((await call('/api/checkout',{pack:'starter',mode:'test'},'test-request-production')).status,503);assert.equal(calls.length,0);
 assert.equal((await call('/api/admin/settings',{paymentMode:'live',livePaymentsEnabled:true})).status,200);assert.equal((await call('/api/config')).data.paymentsEnabled,true);
}));

test('development and locked production cannot configure or start live checkout',async()=>{
 for(const options of [{origin:'https://dev.jamboodle.com',allowed:true},{origin:'https://coasterprint.com',allowed:false},{origin:'http://coasterprint.com',allowed:true}])await fixture(async({call,ledger,admin,calls})=>{
  for(const body of [{liveSecretKey:'sk_live_fixture'},{paymentMode:'live'},{livePaymentsEnabled:true}])assert.equal((await call('/api/admin/settings',body)).status,400);
  ledger.saveSettings(admin,{paymentMode:'live',livePaymentsEnabled:true,liveSecretKey:'sk_live_fixture',liveWebhookSecret:liveSecret,billingEnabled:true});assert.equal((await call('/api/checkout',{pack:'starter',mode:'live'},'blocked-live-request-1234')).status,503);assert.equal(calls.length,0);
 },options);
});

test('live checkout and signed fulfillment are mode-bound, idempotent and survive disabling new purchases',()=>fixture(async({ledger,admin,runtime,call,webhook,calls})=>{
 await configure(call);await call('/api/admin/settings',{billingEnabled:true,paymentMode:'live',livePaymentsEnabled:true});
 assert.equal((await call('/api/checkout',{pack:'standard'},'old-page-no-mode-1234')).status,409);assert.equal(calls.length,0);
 const result=await call('/api/checkout',{pack:'standard',mode:'live'},'live-standard-request-1234');assert.equal(result.status,200);assert.equal(calls[0].headers.Authorization,'Bearer sk_live_fixture');assert.equal(calls[0].body.get('line_items[0][price_data][unit_amount]'),'1000');assert.doesNotMatch(calls[0].body.get('line_items[0][price_data][product_data][name]'),/test/);assert.equal(new URL(calls[0].body.get('success_url')).searchParams.get('paymentMode'),'live');assert.equal(ledger.balance(admin),15);
 const order=ledger.db.prepare('SELECT * FROM orders WHERE id=?').get(result.data.order);assert.equal(order.payment_mode,'live');
 assert.equal(await webhook(payment(order),'live',testSecret),400);
 const wrong=payment(order,'evt_test_wrong');wrong.livemode=false;wrong.data.object.livemode=false;assert.equal(await webhook(wrong),200);assert.equal(ledger.balance(admin),15);
 runtime.allowed=false;assert.equal((await call('/api/admin/settings',{livePaymentsEnabled:false,billingEnabled:false,paymentMode:'test'})).status,200);assert.equal((await call('/api/checkout',{pack:'standard',mode:'live'},'live-after-disable-1234')).status,503);
 for(const status of await Promise.all([webhook(payment(order)),webhook(payment(order)),webhook(payment(order,'evt_duplicate'))]))assert.equal(status,200);
 assert.equal(ledger.balance(admin),65);const safe=(await call('/api/admin/settings')).data;assert.equal(safe.liveSecretKey,undefined);assert.equal(safe.liveWebhookSecret,undefined);assert.equal(JSON.stringify((await call('/api/admin/audit')).data).includes('sk_live_fixture'),false);
}));

test('key mode validation, provider-mode checks and cross-mode retry references fail closed',()=>fixture(async({ledger,admin,call,calls,setBadMode})=>{
 assert.equal((await call('/api/admin/settings',{liveSecretKey:'sk_test_wrong'})).status,400);assert.equal((await call('/api/admin/settings',{secretKey:'sk_live_wrong'})).status,400);assert.equal((await call('/api/admin/settings',{livePaymentsEnabled:true})).status,400);
 await configure(call);await call('/api/admin/settings',{billingEnabled:true,paymentMode:'live',livePaymentsEnabled:true});assert.equal((await call('/api/admin/settings',{liveSecretKey:'sk_live_new'})).status,400);
 ledger.checkoutOrder(admin,'same-reference-across-modes',Date.now(),{id:'starter',amount:500,credits:10,currency:'usd'},'test');assert.equal((await call('/api/checkout',{pack:'starter',mode:'live'},'same-reference-across-modes')).status,409);assert.equal(calls.length,0);
 setBadMode(true);assert.equal((await call('/api/checkout',{pack:'starter',mode:'live'},'wrong-provider-mode-1234')).status,502);assert.equal(ledger.balance(admin),15);
}));

test('unrelated Stripe project events are ignored and an event racing checkout attachment requests retry',()=>fixture(async({ledger,admin,call,webhook})=>{
 await configure(call);const unrelated={id:'evt_other_app',type:'checkout.session.completed',livemode:true,data:{object:{id:'cs_other_project',livemode:true,payment_status:'paid',mode:'payment',amount_total:500,currency:'usd'}}};assert.equal(await webhook(unrelated),200);assert.equal(ledger.balance(admin),15);
 const order=ledger.checkoutOrder(admin,'attachment-race-reference',Date.now(),{id:'starter',amount:500,credits:10,currency:'usd'},'live'),event=payment({...order,session:'cs_racing_attach'},'evt_race');assert.equal(await webhook(event),500);assert.equal(ledger.balance(admin),15);ledger.attachSession(order.id,'cs_racing_attach');assert.equal(await webhook(event),200);assert.equal(ledger.balance(admin),25);
}));


test('restricted live keys retain production guards and are used for hosted checkout',()=>fixture(async({call,calls})=>{
 await configure(call,'rk_live_fixture');assert.equal((await call('/api/admin/settings',{paymentMode:'live',livePaymentsEnabled:true,billingEnabled:true})).status,200);assert.equal((await call('/api/checkout',{pack:'starter',mode:'live'},'restricted-live-request-1234')).status,200);assert.equal(calls[0].headers.Authorization,'Bearer rk_live_fixture');assert.equal((await call('/api/admin/settings')).data.liveSecretKey,undefined);
}));

test('restricted sandbox keys work, while both restricted key modes reject the wrong settings field',()=>fixture(async({call,calls,setBadMode})=>{
 assert.equal((await call('/api/admin/settings',{secretKey:'rk_live_wrong'})).status,400);assert.equal((await call('/api/admin/settings',{liveSecretKey:'rk_test_wrong'})).status,400);
 assert.equal((await call('/api/admin/settings',{secretKey:'rk_test_fixture',webhookSecret:testSecret,billingEnabled:true})).status,200);setBadMode(true);assert.equal((await call('/api/checkout',{pack:'starter',mode:'test'},'restricted-test-request-1234')).status,200);assert.equal(calls[0].headers.Authorization,'Bearer rk_test_fixture');
},{origin:'https://dev.jamboodle.com',allowed:false}));
