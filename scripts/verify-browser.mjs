import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
import {withStatic} from '../server/static.mjs';
const ledger=new Ledger(':memory:');
const fixture=ledger.registerIdentity('browser@example.com','salt','digest','Browser fixture'),session=ledger.createSession(fixture);let origin;
const app=withStatic((req,res)=>handler({ledger,origin})(req,res),fileURLToPath(new URL('../dist/',import.meta.url)));
const server=createServer((req,res)=>{if(!req.headers.cookie)res.setHeader('Set-Cookie',`cl_session=${session}; HttpOnly; SameSite=Strict; Path=/`);return app(req,res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
try{
 for(const name of ['verify-export-versions.mjs','smoke.cjs','verify-maker.cjs','verify-mobile-export.cjs','verify-layout.mjs','verify-pricing.cjs','verify-pricing-layout.mjs','verify-checkout.mjs','verify-accounts.mjs','verify-recovery.mjs','verify-export-trial.mjs','verify-admin.mjs','verify-batch-access.mjs']){
  const status=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[fileURLToPath(new URL(name,import.meta.url))],{stdio:'inherit',env:{...process.env,SITE_URL:'http://127.0.0.1:'+server.address().port}});
   child.once('error',reject);child.once('exit',(code)=>resolve(code ?? 1));
  });
  if(status!==0){process.exitCode=status;break;}
 }
}finally{await new Promise(r=>server.close(r));ledger.close();}
