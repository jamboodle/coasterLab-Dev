import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
import {withStatic} from '../server/static.mjs';
const ledger=new Ledger(':memory:');
const server=createServer(withStatic(handler({ledger,origin:'http://127.0.0.1'}),fileURLToPath(new URL('../dist/',import.meta.url))));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 for(const name of ['smoke.cjs','verify-maker.cjs','verify-mobile-export.cjs','verify-pricing.cjs','verify-checkout.mjs','verify-accounts.mjs','verify-recovery.mjs']){
  const status=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[fileURLToPath(new URL(name,import.meta.url))],{stdio:'inherit',env:{...process.env,SITE_URL:'http://127.0.0.1:'+server.address().port}});
   child.once('error',reject);child.once('exit',(code)=>resolve(code ?? 1));
  });
  if(status!==0){process.exitCode=status;break;}
 }
}finally{await new Promise(r=>server.close(r));ledger.close();}
