import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';

async function fixture(run){const ledger=new Ledger(':memory:');let origin;const admin=ledger.registerIdentity('admin@example.com','salt','digest','Admin');ledger.makeAdmin('admin@example.com');const cookie='cl_session='+ledger.createSession(admin);const server=createServer((req,res)=>handler({ledger,origin,secureExports:false,customerAccounts:true})(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const call=async(path,{body,cookie:session=cookie}={})=>{const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:session,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};};try{await run({ledger,admin,call,cookie});}finally{await new Promise(resolve=>server.close(resolve));ledger.close();}}

test('batch access is 1 for guests and zero balances, 6 for positive registered accounts; 6-image exports debit six once',()=>fixture(async({ledger,admin,call})=>{
 assert.deepEqual((await call('/api/maker-access',{cookie:''})).data,{registered:false,credits:0,maxImages:1});
 const id=ledger.registerIdentity('maker@example.com','salt','digest','Maker'),cookie='cl_session='+ledger.createSession(id);
 assert.equal((await call('/api/maker-access',{cookie})).data.maxImages,6);
 const body={fingerprint:'a'.repeat(64),count:6};await call('/api/admin/settings',{body:{billingEnabled:true}});
 assert.equal((await call('/api/export-quote',{cookie,body})).data.cost,6);assert.equal(ledger.balance(id),15);
 const results=await Promise.all([call('/api/export-debit',{cookie,body}),call('/api/export-debit',{cookie,body})]);assert.ok(results.every(result=>result.status===200));assert.equal(ledger.balance(id),9);assert.equal(ledger.activity(id).filter(entry=>entry.kind==='export_trial').length,1);
 assert.equal((await call('/api/export-debit',{cookie,body:{...body,count:7}})).status,400);
 ledger.adjustCredits(admin,id,-9,'Zero balance test',randomUUID());assert.equal((await call('/api/maker-access',{cookie})).data.maxImages,1);
 assert.equal((await call('/api/export-debit',{cookie,body})).data.cost,0,'Paid retry remains free at zero balance');
 ledger.adjustCredits(admin,id,1,'Positive balance test',randomUUID());assert.equal((await call('/api/maker-access',{cookie})).data.maxImages,6);
 ledger.suspend(admin,id,true);assert.equal((await call('/api/maker-access',{cookie})).data.maxImages,1);
}));

test('admin users sort across pages by name, join date, last visit and balance with stable totals',()=>fixture(async({ledger,call})=>{
 const ids=[];for(let i=0;i<13;i++){const id=ledger.registerIdentity(`person${String(i).padStart(2,'0')}@example.com`,'salt','digest',`Person ${String(12-i).padStart(2,'0')}`);ids.push(id);ledger.db.prepare('UPDATE identities SET joined_at=?,last_visited_at=? WHERE account=?').run(1000+i*1000,2000+(12-i)*1000,id);if(i)ledger.grantTestCredits(id,i);}
 for(const sort of ['name','joined','lastVisited','credits'])for(const direction of ['asc','desc']){
  const first=await call(`/api/admin/users?search=person&limit=10&sort=${sort}&direction=${direction}`),second=await call(`/api/admin/users?search=person&limit=10&offset=10&sort=${sort}&direction=${direction}`);assert.equal(first.data.total,13);assert.equal(first.data.users.length,10);assert.equal(second.data.users.length,3);
  const users=[...first.data.users,...second.data.users];assert.equal(new Set(users.map(user=>user.account)).size,13);
  const key={name:'name',joined:'joined_at',lastVisited:'last_visited_at',credits:'credits'}[sort];const values=users.map(user=>user[key]);const expected=[...values].sort((a,b)=>typeof a==='string'?a.localeCompare(b):a-b);if(direction==='desc')expected.reverse();assert.deepEqual(values,expected);
 }
 assert.equal((await call('/api/admin/users?sort=credits;DROP')).status,400);assert.equal((await call('/api/admin/users?direction=invalid')).status,400);assert.equal((await call('/api/admin/users?limit=1000')).status,400);
 assert.equal((await call('/api/admin/users?search=Person%2003')).data.total,1);
 ledger.db.prepare('UPDATE identities SET joined_at=NULL,last_visited_at=NULL WHERE account=?').run(ids[0]);const unknown=(await call('/api/admin/users?search=person00')).data.users[0];assert.equal(unknown.joined_at,null);assert.equal(unknown.last_visited_at,null);
}));

test('registration captures optional name, profile changes preserve credits and visits persist without changing joined date',()=>fixture(async({ledger,call})=>{
 const registration={email:'newperson@example.com',password:'new-person-fixture-password',name:'New Person'};
 assert.equal((await call('/api/register',{cookie:'',body:{...registration,name:'bad\nname'}})).status,400);
 const created=await call('/api/register',{cookie:'',body:registration});assert.equal(created.status,201);const identity=ledger.identity(registration.email);assert.equal(identity.name,'New Person');assert.ok(identity.joined_at>0);assert.ok(identity.last_visited_at>0);
 const cookie='cl_session='+ledger.createSession(identity.account),joined=identity.joined_at;
 await call('/api/profile',{cookie,body:{name:'Updated Name'}});assert.equal((await call('/api/account',{cookie})).data.name,'Updated Name');assert.equal(ledger.balance(identity.account),15);
 ledger.touchVisit(identity.account,identity.last_visited_at+61000);assert.equal(ledger.identity(registration.email).joined_at,joined);assert.equal(ledger.identity(registration.email).last_visited_at,identity.last_visited_at+61000);
 assert.equal((await call('/api/profile',{cookie,body:{name:'x'.repeat(81)}})).status,400);
}));


test('legacy identities retain balances without invented names or dates after migration',()=>{
 const directory=mkdtempSync(join(tmpdir(),'coasterprint-user-migration-'));let ledger;
 try{const path=join(directory,'credits.sqlite'),db=new DatabaseSync(path);db.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL);CREATE TABLE identities(email TEXT PRIMARY KEY,account TEXT UNIQUE NOT NULL REFERENCES accounts(id),salt TEXT NOT NULL,digest TEXT NOT NULL);CREATE TABLE entries(id TEXT PRIMARY KEY,account TEXT NOT NULL REFERENCES accounts(id),delta INTEGER NOT NULL,kind TEXT NOT NULL);INSERT INTO accounts VALUES ('legacy','hash');INSERT INTO identities VALUES ('legacy@example.com','legacy','salt','digest');INSERT INTO entries VALUES ('existing-credit','legacy',12,'purchase');`);db.close();ledger=new Ledger(path);const old=ledger.identity('legacy@example.com');assert.equal(old.name,'');assert.equal(old.joined_at,null);assert.equal(old.last_visited_at,null);assert.equal(ledger.balance('legacy'),12);ledger.updateName('legacy','Legacy Maker');ledger.touchVisit('legacy',1700000000000);ledger.close();ledger=new Ledger(path);assert.equal(ledger.identity('legacy@example.com').name,'Legacy Maker');assert.equal(ledger.identity('legacy@example.com').last_visited_at,1700000000000);assert.equal(ledger.balance('legacy'),12);
 }finally{ledger?.close();rmSync(directory,{recursive:true,force:true});}
});
