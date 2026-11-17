import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
import {passwordHash,passwordMatches} from '../server/passwords.mjs';
test('password change requires current password, rotates sessions and preserves credits',async()=>{
 const ledger=new Ledger(':memory:');const original=await passwordHash('original-password');
 const id=ledger.registerIdentity('maker@example.com',original.salt,original.digest);
 const current=ledger.createSession(id),other=ledger.createSession(id);const otherAccount=ledger.createAccount();
 const order=ledger.createOrder(id);ledger.attachSession(order,'cs_security');
 ledger.creditPayment({id:'evt_security',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_security',livemode:false,mode:'payment',payment_status:'paid',currency:'usd',amount_total:500}}});
 let origin;const server=createServer((req,res)=>handler({ledger,origin,customerAccounts:true})(req,res));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const headers={Origin:origin,Cookie:'cl_session='+current};
 const change=(currentPassword,newPassword,override={})=>fetch(origin+'/api/password',{method:'POST',headers:{...headers,...override},body:JSON.stringify({currentPassword,newPassword})});
 try{
  assert.equal((await change('original-password','replacement-password',{Origin:'https://other.example'})).status,403);
  assert.equal((await change('wrong-password','replacement-password')).status,401);
  assert.equal((await change('original-password','short')).status,400);
  assert.equal((await change('original-password','original-password')).status,400);
  assert.equal(ledger.sessionAccount(other),id);
  const response=await change('original-password','replacement-password');assert.equal(response.status,200);
  assert.equal(ledger.sessionAccount(current),undefined);assert.equal(ledger.sessionAccount(other),undefined);
  assert.ok(await passwordMatches('replacement-password',ledger.identity('maker@example.com')));
  assert.equal(await passwordMatches('original-password',ledger.identity('maker@example.com')),false);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const account=await (await fetch(origin+'/api/account',{headers:{Cookie:cookie}})).json();
  assert.equal(account.credits,25);assert.equal(account.email,'maker@example.com');assert.equal(account.activity.length,2);
  assert.equal(account.activity[0].delta,10);
  assert.equal((await fetch(origin+'/api/logout-all',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+otherAccount.token}})).status,403);
  assert.equal(ledger.authenticate(otherAccount.token),otherAccount.id);
  const foreign=await (await fetch(origin+'/api/account',{headers:{Authorization:'Bearer '+otherAccount.token}})).json();
  assert.equal(foreign.credits,0);assert.deepEqual(foreign.activity,[]);assert.equal(foreign.passwordAccount,false);
  const extra=ledger.createSession(id);
  assert.equal((await fetch(origin+'/api/logout-all',{method:'POST',headers:{Origin:origin,Cookie:cookie}})).status,200);
  assert.equal(ledger.sessionAccount(extra),undefined);
  assert.equal((await fetch(origin+'/api/balance',{headers:{Cookie:cookie}})).status,401);
 }finally{await new Promise(r=>server.close(r));ledger.close();}
});
test('bulk sign-out revokes bearer tokens as well as all sessions',()=>{
 const ledger=new Ledger(':memory:');try{
  const account=ledger.createAccount();const session=ledger.createSession(account.id);
  ledger.revokeAllSessions(account.id);
  assert.equal(ledger.authenticate(account.token),undefined);assert.equal(ledger.sessionAccount(session),undefined);
 }finally{ledger.close();}
});
test('stale password update cannot overwrite a newer password',async()=>{
 const ledger=new Ledger(':memory:');try{
  const first=await passwordHash('first-password'),next=await passwordHash('second-password');
  const id=ledger.registerIdentity('race@example.com',first.salt,first.digest);
  assert.ok(ledger.changePassword(id,first.digest,next.salt,next.digest));
  assert.equal(ledger.changePassword(id,first.digest,first.salt,first.digest),false);
  assert.equal(ledger.identity('race@example.com').digest,next.digest);
 }finally{ledger.close();}
});
