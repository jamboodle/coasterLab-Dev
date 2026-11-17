import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHmac} from 'node:crypto';
import {createServer} from 'node:http';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';

async function fixture(run){
 const ledger=new Ledger(':memory:');let origin;
 const admin=ledger.registerIdentity('admin@example.com','salt','digest'),user=ledger.registerIdentity('user@example.com','salt','digest');
 ledger.makeAdmin('admin@example.com');const adminCookie='cl_session='+ledger.createSession(admin),userCookie='cl_session='+ledger.createSession(user);
 const server=createServer((req,res)=>handler({ledger,origin,customerAccounts:true})(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 async function call(path,{body,cookie=adminCookie,requestOrigin=origin}={}){const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:requestOrigin,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};}
 try{await run({ledger,admin,user,call,adminCookie,userCookie,origin});}finally{await new Promise(resolve=>server.close(resolve));ledger.close();}
}

test('admin authorization and CSRF protect users, settings, credits and audit',()=>fixture(async({call,userCookie})=>{
 for(const path of ['/api/admin/users','/api/admin/settings','/api/admin/audit']){
  assert.equal((await call(path,{cookie:''})).status,401);assert.equal((await call(path,{cookie:userCookie})).status,403);
 }
 assert.equal((await call('/api/admin/settings',{body:{billingEnabled:true},requestOrigin:'https://evil.example'})).status,403);
 assert.equal((await call('/api/admin/settings',{body:{billingEnabled:true},cookie:userCookie})).status,403);
 assert.equal((await call('/api/admin/users')).data.users.length,2);
 assert.equal((await call('/api/admin/users?search=user')).data.users.length,1);
}));

test('admin adjustments are idempotent, audited, bounded, and cannot overdraw',()=>fixture(async({call,user,ledger})=>{
 const body={account:user,delta:12,reason:'Customer support',key:randomUUID()};
 const results=await Promise.all([call('/api/admin/credits',{body}),call('/api/admin/credits',{body})]);
 assert.ok(results.every(result=>result.status===200));assert.equal(ledger.balance(user),27);
 assert.equal(ledger.auditLog().filter(row=>row.action==='credits').length,1);
 assert.equal((await call('/api/admin/credits',{body:{...body,delta:13}})).status,400);
 assert.equal((await call('/api/admin/credits',{body:{...body,delta:-28,key:randomUUID()}})).status,400);
 assert.equal((await call('/api/admin/credits',{body:{...body,delta:-7,key:randomUUID()}})).data.credits,20);
 assert.equal((await call('/api/admin/credits',{body:{...body,delta:0.5,key:randomUUID()}})).status,400);
}));

test('suspension revokes sessions, preserves unique email and prevents suspending admins',()=>fixture(async({call,ledger,user,admin,userCookie})=>{
 assert.equal((await call('/api/admin/suspend',{body:{account:user,suspended:true}})).status,200);
 assert.equal((await call('/api/account',{cookie:userCookie})).status,401);
 assert.equal(ledger.registerIdentity(' USER@EXAMPLE.COM ','new','new'),null);
 assert.equal(ledger.balance(user),15);
 assert.equal((await call('/api/admin/suspend',{body:{account:admin,suspended:true}})).status,400);
 assert.equal((await call('/api/admin/suspend',{body:{account:user,suspended:false}})).status,200);
 assert.equal(ledger.sessionAccount(userCookie.split('=')[1]),undefined);
}));

test('billing switch changes exports immediately, free mode does not debit, secrets never returned',()=>fixture(async({call,ledger,user,userCookie})=>{
 const body={fingerprint:'a'.repeat(64),count:2};
 assert.equal((await call('/api/export-quote',{body,cookie:''})).status,401);
 assert.equal((await call('/api/export-debit',{body,cookie:userCookie})).data.cost,0);assert.equal(ledger.balance(user),15);
 assert.equal((await call('/api/admin/settings',{body:{billingEnabled:true,amount:999,credits:30,secretKey:'sk_test_example',webhookSecret:'whsec_example'}})).status,200);
 const settings=(await call('/api/admin/settings')).data;assert.equal(settings.secretKeyConfigured,true);assert.equal(settings.secretKey,undefined);assert.equal(settings.webhookSecret,undefined);
 const config=(await call('/api/config')).data;assert.equal(config.amount,999);assert.equal(config.credits,30);assert.equal(config.exportLoginRequired,true);assert.equal(config.paymentsEnabled,true);
 assert.equal((await call('/api/export-debit',{body,cookie:userCookie})).data.cost,2);assert.equal(ledger.balance(user),13);
 assert.equal((await call('/api/export-debit',{body,cookie:userCookie})).data.cost,0);
 ledger.adjustCredits(user,user,-13,'Test empty balance',randomUUID());
 assert.equal((await call('/api/export-debit',{body:{...body,fingerprint:'b'.repeat(64)},cookie:userCookie})).status,402);
 await call('/api/admin/settings',{body:{billingEnabled:false}});
 assert.equal((await call('/api/export-debit',{body:{...body,fingerprint:'b'.repeat(64)},cookie:userCookie})).data.cost,0);
 assert.equal((await call('/api/admin/settings',{body:{secretKey:'sk_live_example'}})).status,400);
 assert.equal((await call('/api/admin/settings',{body:{amount:-10}})).status,400);
 assert.equal(JSON.stringify((await call('/api/admin/audit')).data).includes('sk_test_example'),false);
}));

test('new registrations receive welcome credits exactly once, including email case variants',async()=>{
 const ledger=new Ledger(':memory:');try{const id=ledger.registerIdentity(' Maker@Example.com ','salt','digest');assert.equal(ledger.balance(id),15);assert.equal(ledger.registerIdentity('maker@example.com','salt2','digest2'),null);assert.equal(ledger.balance(id),15);assert.equal(ledger.activity(id).length,1);}finally{ledger.close();}
});

test('checkout price and credit snapshots survive admin price changes and billing disable',async()=>{
 const ledger=new Ledger(':memory:');const account=ledger.createAccount();let origin;let form;
 ledger.db.prepare('INSERT INTO settings VALUES (?,?)').run('billingEnabled','true');
 ledger.db.prepare('INSERT INTO settings VALUES (?,?)').run('amount','725');ledger.db.prepare('INSERT INTO settings VALUES (?,?)').run('credits','22');
 const secret='whsec_test';
 const server=createServer((req,res)=>handler({ledger,origin,secretKey:'sk_test_example',webhookSecret:secret,fetchImpl:async(_url,options)=>{form=options.body;return Response.json({id:'cs_snapshot',url:'https://checkout.stripe.com/example'});}})(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 try{
  const headers={Authorization:'Bearer '+account.token,'Idempotency-Key':'snapshot-request-1234'};
  assert.equal((await fetch(origin+'/api/checkout',{method:'POST',headers})).status,200);assert.equal(form.get('line_items[0][price_data][unit_amount]'),'725');
  ledger.db.prepare('UPDATE settings SET value=? WHERE key=?').run('1000','amount');ledger.db.prepare('UPDATE settings SET value=? WHERE key=?').run('50','credits');
  assert.equal((await fetch(origin+'/api/checkout',{method:'POST',headers})).status,200);assert.equal(form.get('line_items[0][price_data][unit_amount]'),'725');
  ledger.db.prepare('UPDATE settings SET value=? WHERE key=?').run('false','billingEnabled');
  assert.equal((await fetch(origin+'/api/checkout',{method:'POST',headers})).status,503);
  const event={id:'evt_snapshot',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_snapshot',livemode:false,payment_status:'paid',mode:'payment',amount_total:725,currency:'usd'}}},body=JSON.stringify(event),time=Math.floor(Date.now()/1000);
  const signature=`t=${time},v1=${createHmac('sha256',secret).update(time+'.'+body).digest('hex')}`;
  for(let i=0;i<2;i++)assert.equal((await fetch(origin+'/api/webhooks/stripe',{method:'POST',headers:{'stripe-signature':signature},body})).status,200);
  assert.equal(ledger.balance(account.id),22);
 }finally{await new Promise(resolve=>server.close(resolve));ledger.close();}
});


test('admin roles, settings and adjusted balances survive restart without another welcome grant',()=>{
 const directory=mkdtempSync(join(tmpdir(),'coasterprint-admin-'));let ledger;
 try{
  const path=join(directory,'credits.sqlite');ledger=new Ledger(path);
  const admin=ledger.registerIdentity('admin@example.com','salt','digest'),user=ledger.registerIdentity('user@example.com','salt','digest');
  ledger.makeAdmin('admin@example.com');ledger.saveSettings(admin,{billingEnabled:true,amount:850,credits:40});ledger.adjustCredits(admin,user,9,'Support credit',randomUUID());ledger.suspend(admin,user,true);ledger.close();ledger=new Ledger(path);
  assert.equal(ledger.control(admin).admin,1);assert.equal(ledger.control(user).suspended,1);assert.equal(ledger.balance(user),24);assert.equal(ledger.settings().amount,850);assert.equal(ledger.settings().billingEnabled,true);assert.equal(ledger.activity(user).filter(row=>row.kind==='welcome').length,1);assert.equal(ledger.auditLog().length,3);
 }finally{ledger?.close();rmSync(directory,{recursive:true,force:true});}
});
