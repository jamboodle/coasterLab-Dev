import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
import {credentials,passwordHash,passwordMatches} from '../server/passwords.mjs';
test('passwords use unique salts and reject incorrect credentials',async()=>{
 const password='coaster-test-password';const a=await passwordHash(password),b=await passwordHash(password);
 assert.notEqual(a.salt,b.salt);assert.notEqual(a.digest,b.digest);
 assert.ok(await passwordMatches(password,a));assert.equal(await passwordMatches('wrong-password',a),false);
 assert.equal(await passwordMatches(password,undefined),false);
 assert.equal(credentials({email:'bad',password}),null);
 assert.equal(credentials({email:'test@example.com',password:'short'}),null);
 assert.equal(credentials({email:'test@example.com',password:'x'.repeat(129)}),null);
 assert.equal(credentials({email:' TEST@EXAMPLE.COM ',password}).email,'test@example.com');
});
test('customer registration, sign-in, duplicate account, cookie rotation and origin protection',async()=>{
 const ledger=new Ledger(':memory:');let origin;
 const server=createServer((req,res)=>handler({ledger,origin,customerAccounts:true})(req,res));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const details={email:'Customer@Example.com',password:'my-long-test-password'};
 const post=(path,data=details,headers={})=>fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 try{
  assert.equal((await post('/api/register',details,{Origin:'https://other.example'})).status,403);
  assert.equal((await post('/api/register',null)).status,400);
  assert.equal((await post('/api/register',{...details,password:'short'})).status,400);
  const registration=await post('/api/register');assert.equal(registration.status,201);
  const cookie=registration.headers.get('set-cookie').split(';')[0];
  const identity=ledger.identity('customer@example.com');assert.ok(identity);assert.notEqual(identity.digest,details.password);
  assert.equal((await post('/api/register')).status,409);
  assert.equal(ledger.db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count,1);
  const wrong=await post('/api/login',{...details,password:'incorrect-password'});assert.equal(wrong.status,401);
  const absent=await post('/api/login',{...details,email:'absent@example.com'});assert.equal(absent.status,401);
  assert.deepEqual(await wrong.json(),await absent.json());
  const login=await post('/api/login',{...details,email:'customer@example.com'},{Cookie:cookie});assert.equal(login.status,200);
  const nextCookie=login.headers.get('set-cookie').split(';')[0];assert.notEqual(nextCookie,cookie);
  assert.equal((await fetch(origin+'/api/balance',{headers:{Cookie:cookie}})).status,401);
  assert.equal((await (await fetch(origin+'/api/balance',{headers:{Cookie:nextCookie}})).json()).credits,0);
  assert.equal((await post('/api/logout',{}, {Cookie:nextCookie})).status,200);
  assert.equal((await fetch(origin+'/api/balance',{headers:{Cookie:nextCookie}})).status,401);
 }finally{await new Promise(r=>server.close(r));ledger.close();}
});
test('authentication throttle resets after the window and survives handler recreation',()=>{
 const ledger=new Ledger(':memory:');try{
  for(let n=0;n<20;n++)assert.ok(ledger.allowAuth('test-ip',1000));
  assert.equal(ledger.allowAuth('test-ip',1000),false);
  assert.ok(ledger.allowAuth('other-ip',1000));
  assert.ok(ledger.allowAuth('test-ip',901001));
 }finally{ledger.close();}
});
test('account endpoints are opt-in and throttle repeated HTTP attempts',async()=>{
 for(const enabled of [false,true]){
  const ledger=new Ledger(':memory:');let origin;
  const server=createServer((req,res)=>handler({ledger,origin,customerAccounts:enabled})(req,res));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
  try{
   const attempt=()=>fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin},body:'null'});
   if(!enabled)assert.equal((await attempt()).status,404);
   else{
    for(let n=0;n<20;n++)assert.equal((await attempt()).status,400);
    const limited=await attempt();assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'900');
   }
  }finally{await new Promise(r=>server.close(r));ledger.close();}
 }
});
