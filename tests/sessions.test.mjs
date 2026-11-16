import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
import {withStatic} from '../server/static.mjs';
test('sessions expire and can be revoked',()=>{
 const ledger=new Ledger(':memory:');try{
  const account=ledger.createAccount();const token=ledger.createSession(account.id);
  assert.equal(ledger.sessionAccount(token),account.id);
  ledger.db.prepare('UPDATE sessions SET expires=0').run();
  assert.equal(ledger.sessionAccount(token),undefined);
  const next=ledger.createSession(account.id);ledger.revokeSession(next);
  assert.equal(ledger.sessionAccount(next),undefined);
 }finally{ledger.close();}
});
test('same-origin login, HttpOnly cookies, logout revocation and static isolation',async()=>{
 const ledger=new Ledger(':memory:');const account=ledger.createAccount();
 let origin='';const api=(req,res)=>handler({ledger,origin,developmentLogin:true})(req,res);
 const server=createServer(withStatic(api,fileURLToPath(new URL('../dist/',import.meta.url))));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 try{
  const login=(headers={})=>fetch(origin+'/api/session',{method:'POST',headers,body:JSON.stringify({token:account.token})});
  assert.equal((await login()).status,403);
  assert.equal((await login({Origin:'https://other.example'})).status,403);
  const response=await login({Origin:origin});assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly; SameSite=Strict/);assert.match(cookie,/Max-Age=86400/);
  const headers={Cookie:cookie.split(';')[0]};
  assert.equal((await fetch(origin+'/api/balance',{headers})).status,200);
  assert.equal((await fetch(origin+'/api/logout',{method:'POST',headers})).status,403);
  assert.equal((await fetch(origin+'/api/logout',{method:'POST',headers:{...headers,Origin:origin}})).status,200);
  assert.equal((await fetch(origin+'/api/balance',{headers})).status,401);
  assert.equal((await fetch(origin+'/pricing/')).status,200);
  assert.equal((await fetch(origin+'/server/ledger.mjs')).status,404);
  assert.equal((await fetch(origin+'/.data/credits.sqlite')).status,404);
  assert.equal((await fetch(origin+'/%2e%2e%2fserver/ledger.mjs')).status,404);
  assert.equal((await fetch(origin+'/vendor/manifold.wasm')).headers.get('content-type'),'application/wasm');
  const redirect=await fetch(origin+'/pricing',{redirect:'manual'});assert.equal(redirect.status,301);assert.equal(redirect.headers.get('location'),'/pricing/');
 }finally{await new Promise(r=>server.close(r));ledger.close();}
});
