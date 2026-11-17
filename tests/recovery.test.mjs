import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
import {DevelopmentMailbox} from '../server/mailbox.mjs';
import {passwordHash,passwordMatches} from '../server/passwords.mjs';
test('verification and reset links are purpose-bound, single-use, expired and hashed at rest',async()=>{
 const ledger=new Ledger(':memory:');try{
  const initial=await passwordHash('first-test-password');const id=ledger.registerIdentity('maker@example.com',initial.salt,initial.digest);
  const verify=ledger.issueChallenge(id,'verify');
  assert.equal(ledger.challenge(verify,'reset'),null);
  assert.equal(ledger.db.prepare('SELECT hash FROM challenges').get().hash===verify,false);
  assert.ok(ledger.verifyEmail(verify));assert.ok(ledger.identity('maker@example.com').verified_at);
  assert.equal(ledger.verifyEmail(verify),false);
  const old=ledger.issueChallenge(id,'reset',Date.now()-1800001);assert.equal(ledger.challenge(old,'reset'),null);
  const reset=ledger.issueChallenge(id,'reset');const cookie=ledger.createSession(id);const next=await passwordHash('replacement-password');
  assert.ok(ledger.resetPassword(reset,next.salt,next.digest));assert.equal(ledger.sessionAccount(cookie),undefined);
  assert.equal(ledger.resetPassword(reset,initial.salt,initial.digest),false);
  assert.ok(await passwordMatches('replacement-password',ledger.identity('maker@example.com')));
  const stale=ledger.issueChallenge(id,'reset');
  assert.ok(ledger.changePassword(id,next.digest,initial.salt,initial.digest));
  assert.equal(ledger.resetPassword(stale,next.salt,next.digest),false);
 }finally{ledger.close();}
});
test('recovery HTTP flow does not disclose unknown accounts and preserves balances',async()=>{
 const ledger=new Ledger(':memory:');const mailbox=new DevelopmentMailbox();let origin;
 const server=createServer((req,res)=>handler({ledger,origin,customerAccounts:true,mailer:mailbox,developmentInbox:true})(req,res));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const details={email:'maker@example.com',password:'first-test-password'};
 const post=(path,body,headers={})=>fetch(origin+path,{method:'POST',headers:{Origin:origin,...headers},body:JSON.stringify(body)});
 try{
  assert.equal((await fetch(origin+'/api/dev/inbox',{headers:{Origin:'https://other.example'}})).status,404);
  assert.equal((await fetch(origin+'/api/dev/inbox')).status,200);
  const registered=await post('/api/register',details);assert.equal(registered.status,201);assert.equal((await registered.json()).verificationSent,true);
  const cookie=registered.headers.get('set-cookie').split(';')[0];const id=ledger.identity(details.email).account;
  const order=ledger.createOrder(id);ledger.attachSession(order,'cs_recovery');ledger.creditPayment({id:'evt_recovery',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_recovery',livemode:false,payment_status:'paid',mode:'payment',amount_total:500,currency:'usd'}}});
  const verify=new URL(mailbox.list()[0].url);assert.equal(verify.search,'');const verifyToken=new URLSearchParams(verify.hash.slice(1)).get('verify');
  assert.equal((await post('/api/verify-email',{token:verifyToken})).status,200);
  const known=await post('/api/recovery',{email:details.email});const unknown=await post('/api/recovery',{email:'missing@example.com'});
  assert.equal(known.status,unknown.status);assert.deepEqual(await known.json(),await unknown.json());
  const reset=new URL(mailbox.list()[0].url);const token=new URLSearchParams(reset.hash.slice(1)).get('reset');
  assert.equal((await post('/api/reset-password',{token,password:'replacement-password'},{Origin:'https://other.example'})).status,403);
  assert.equal((await post('/api/reset-password',{token,password:'short'})).status,400);
  assert.equal((await post('/api/reset-password',{token,password:'replacement-password'})).status,200);
  assert.equal((await fetch(origin+'/api/account',{headers:{Cookie:cookie}})).status,401);
  assert.equal(ledger.balance(id),25);
  assert.equal((await post('/api/reset-password',{token,password:'third-test-password'})).status,400);
  assert.equal((await post('/api/login',details)).status,401);
  assert.equal((await post('/api/login',{...details,password:'replacement-password'})).status,200);
 }finally{await new Promise(r=>server.close(r));ledger.close();}
});
test('email routes and development inbox are disabled without explicit configuration',async()=>{
 const ledger=new Ledger(':memory:');let origin;
 const server=createServer((req,res)=>handler({ledger,origin,customerAccounts:true})(req,res));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(origin+'/api/dev/inbox')).status,404);
  assert.equal((await fetch(origin+'/api/recovery',{method:'POST',headers:{Origin:origin},body:'{}'})).status,503);
 }finally{await new Promise(r=>server.close(r));ledger.close();}
});
