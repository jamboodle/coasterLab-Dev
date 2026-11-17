import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {SendmailMailer,accountMessage,emailAddress} from '../server/sendmail.mjs';
import {configureMailer} from '../server/mail-config.mjs';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
const origin='https://dev.example.com';
const message={to:'maker@example.com',subject:'Verify your CoasterPrint email',url:origin+'/account/#verify='+'a'.repeat(64)};
const from='noreply@example.com';

test('account messages validate envelopes, prevent header injection, and encode usable links',()=>{
 const raw=accountMessage({...message,from,origin});
 const [headers,body]=raw.split('\r\n\r\n');
 assert.match(headers,/From: CoasterPrint <noreply@example.com>/);
 assert.match(headers,/Content-Transfer-Encoding: base64/);
 const text=Buffer.from(body,'base64').toString('utf8');
 assert.ok(text.includes(message.url));assert.match(text,/24 hours/);
 const reset=accountMessage({...message,from,origin,url:origin+'/account/#reset='+'b'.repeat(64)});
 assert.match(Buffer.from(reset.split('\r\n\r\n')[1],'base64').toString('utf8'),/30 minutes/);
 for(const bad of ['maker@example.com\r\nBcc: attacker@example.com','<maker@example.com>','maker@example.com other@example.com'])assert.throws(()=>emailAddress(bad));
 assert.throws(()=>accountMessage({...message,from,origin,subject:'Subject\nBcc: attacker@example.com'}));
 assert.throws(()=>accountMessage({...message,from,origin,url:'https://other.example/account/#verify='+'a'.repeat(64)}));
 assert.throws(()=>accountMessage({...message,from,origin,url:origin+'/account/?token=secret'}));
});

test('local submission passes arguments without a shell and sends MIME through stdin',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'coasterprint-mail-'));
 try{
  const fixture=join(directory,'mail.cjs'),output=join(directory,'captured.json');
  writeFileSync(fixture,"const fs=require('node:fs');let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>fs.writeFileSync(process.argv[2],JSON.stringify({args:process.argv.slice(3),input})));\n");
  const mailer=new SendmailMailer({from,origin,path:process.execPath,spawnImpl:(_command,args,options)=>{
   assert.equal(options.shell,false);
   return spawn(process.execPath,[fixture,output,...args],options);
  }});
  await mailer.send(message);
  const capture=JSON.parse(readFileSync(output,'utf8'));
  assert.deepEqual(capture.args,['-i','-odb','-f',from,'--',message.to]);
  assert.match(capture.input,/To: maker@example.com/);
  assert.ok(Buffer.from(capture.input.split('\r\n\r\n')[1],'base64').toString('utf8').includes(message.url));
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('failed or stalled mail submissions return bounded generic errors, not MTA diagnostics',async()=>{
 const failing=new SendmailMailer({from,origin,path:process.execPath,spawnImpl:(_command,_args,options)=>spawn(process.execPath,['-e',"process.stdin.resume();process.stderr.write('PRIVATE-MTA-DIAGNOSTIC');process.exit(1)"],options)});
 await assert.rejects(failing.send(message),{message:'Email submission failed'});
 const stalled=new SendmailMailer({from,origin,path:process.execPath,timeoutMs:40,spawnImpl:(_command,_args,options)=>spawn(process.execPath,['-e',"process.stdin.resume();setInterval(()=>{},1000)"],options)});
 await assert.rejects(stalled.send(message),{message:'Email submission timed out'});
 const missing=new SendmailMailer({from,origin,path:process.execPath,spawnImpl:()=>{throw Error('PRIVATE-MTA-DIAGNOSTIC');}});
 await assert.rejects(missing.send(message),{message:'Email transport unavailable'});
});

test('mail configuration stays disabled by default and the local inbox takes precedence',()=>{
 assert.equal(configureMailer({},origin).mailer,null);
 assert.throws(()=>configureMailer({EMAIL_TRANSPORT:'sendmail'},origin),/Invalid mail address/);
 assert.throws(()=>configureMailer({EMAIL_TRANSPORT:'smtp'},origin),/EMAIL_TRANSPORT/);
 assert.throws(()=>new SendmailMailer({from,origin:'http://example.com',path:process.execPath}),/HTTPS/);
 const configured=configureMailer({EMAIL_TRANSPORT:'sendmail',EMAIL_FROM:from,SENDMAIL_PATH:process.execPath},origin);
 assert.ok(configured.mailer instanceof SendmailMailer);assert.equal(configured.developmentInbox,false);
 const local=configureMailer({ENABLE_DEV_INBOX:'1',EMAIL_TRANSPORT:'sendmail'},'http://127.0.0.1:3003');
 assert.equal(local.developmentInbox,true);assert.equal(typeof local.mailer.list,'function');
 assert.throws(()=>configureMailer({ENABLE_DEV_INBOX:'1'},origin),/loopback/);
});

test('mail failures preserve registrations, keep recovery private and allow verification retries',async()=>{
 const ledger=new Ledger(':memory:');const failures=[];let serverOrigin;
 const server=createServer((req,res)=>handler({ledger,origin:serverOrigin,customerAccounts:true,mailer:{send:async()=>{throw Error('PRIVATE-MTA-DIAGNOSTIC');}},onMailFailure:event=>failures.push(event)})(req,res));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));serverOrigin='http://127.0.0.1:'+server.address().port;
 const post=(path,data,headers={})=>fetch(serverOrigin+path,{method:'POST',headers:{Origin:serverOrigin,...headers},body:JSON.stringify(data)});
 try{
  const register=await post('/api/register',{email:'maker@example.com',password:'mail-test-password'});
  assert.equal(register.status,201);assert.equal((await register.json()).verificationSent,false);
  const cookie=register.headers.get('set-cookie').split(';')[0];
  const resend=await post('/api/send-verification',{}, {Cookie:cookie});assert.equal(resend.status,503);assert.doesNotMatch(await resend.text(),/PRIVATE/);
  const known=await post('/api/recovery',{email:'maker@example.com'}),unknown=await post('/api/recovery',{email:'unknown@example.com'});
  assert.equal(known.status,200);assert.deepEqual(await known.json(),await unknown.json());
  assert.ok(ledger.identity('maker@example.com'));assert.deepEqual(failures,[{purpose:'verify'},{purpose:'verify'},{purpose:'reset'}]);
 }finally{await new Promise(r=>server.close(r));ledger.close();}
});
