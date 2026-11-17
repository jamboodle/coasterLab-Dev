import {spawn} from 'node:child_process';
import {accessSync,constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';

// One mailbox per envelope/header; no display-name or header injection input.
export function emailAddress(value){
 if(typeof value!=='string' || value.length>254 || /[\r\n\0]/.test(value))throw Error('Invalid mail address');
 if(!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value))throw Error('Invalid mail address');
 return value;
}

export function accountMessage({from,to,subject,url,origin}){
 emailAddress(from);emailAddress(to);
 if(typeof subject!=='string' || subject.length>200 || /[\r\n\0]/.test(subject))throw Error('Invalid email subject');
 const link=new URL(url);
 if(link.origin!==origin || link.protocol!=='https:' || link.pathname!=='/account/' || link.search || link.username || link.password || !/^#(?:verify|reset)=[a-f0-9]{64}$/.test(link.hash))throw Error('Invalid account email link');
 const reset=link.hash.startsWith('#reset=');
 const text=[
  'CoasterPrint', '',
  reset?'A password reset was requested for your CoasterPrint account.':'Welcome to CoasterPrint. Please confirm your email address.', '',
  reset?'Choose a new password using this link:':'Verify your email using this link:',link.href,'',
  reset?'This link expires in 30 minutes and can be used once. Resetting your password signs out all sessions.':'This link expires in 24 hours and can be used once.', '',
  'If you did not request this, you can ignore this email.','',
  'CoasterPrint · '+origin,
 ].join('\n');
 const encodedSubject='=?UTF-8?B?'+Buffer.from(subject).toString('base64')+'?=';
 if(encodedSubject.length>900)throw Error('Email subject is too long');
 const body=Buffer.from(text).toString('base64').match(/.{1,76}/g).join('\r\n');
 return [
  'From: CoasterPrint <'+from+'>','To: '+to,'Subject: '+encodedSubject,
  'Date: '+new Date().toUTCString(),'Message-ID: <'+randomUUID()+'@'+from.split('@')[1]+'>',
  'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64',
  'Auto-Submitted: auto-generated','X-Auto-Response-Suppress: All','',body,'',
 ].join('\r\n');
}

export class SendmailMailer {
 constructor({from,origin,path='/usr/sbin/sendmail',timeoutMs=15000,spawnImpl=spawn}){
  this.from=emailAddress(from);
  const parsed=new URL(origin);
  if(parsed.protocol!=='https:' || parsed.origin!==origin)throw Error('Real email requires an HTTPS APP_ORIGIN');
  if(typeof path!=='string' || !isAbsolute(path) || /[\r\n\0]/.test(path))throw Error('SENDMAIL_PATH must be an absolute executable path');
  accessSync(path,constants.X_OK);
  if(!Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>30000)throw Error('Invalid mail submission timeout');
  Object.assign(this,{origin,path,timeoutMs,spawnImpl});
 }
 async send({to,subject,url}){
  const message=accountMessage({from:this.from,to,subject,url,origin:this.origin});
  await new Promise((resolve,reject)=>{
   let child,timer,finished=false;
   const finish=error=>{
    if(finished)return;finished=true;clearTimeout(timer);
    if(error){child?.kill('SIGKILL');reject(error);}else resolve();
   };
   try{child=this.spawnImpl(this.path,['-i','-odb','-f',this.from,'--',to],{shell:false,stdio:['pipe','ignore','pipe']});}
   catch{finish(Error('Email transport unavailable'));return;}
   // MTA diagnostics may contain recipient data. Never return/log them to the client.
   child.stderr?.resume();
   child.on('error',()=>finish(Error('Email transport unavailable')));
   child.on('close',code=>finish(code===0?null:Error('Email submission failed')));
   child.stdin.on('error',()=>finish(Error('Email submission failed')));
   timer=setTimeout(()=>finish(Error('Email submission timed out')),this.timeoutMs);
   child.stdin.end(message,'utf8');
  });
 }
}
