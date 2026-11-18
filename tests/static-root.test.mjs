import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('server uses public_html for public assets while its database stays in the private app directory',{timeout:15000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'coasterprint-account-')),privateApp=join(root,'app'),publicRoot=join(root,'public_html');mkdirSync(privateApp);mkdirSync(publicRoot);
 writeFileSync(join(publicRoot,'asset-manifest.json'),JSON.stringify({scripts:{}}));writeFileSync(join(publicRoot,'index.html'),'<main id="maker"><input id="files">Independent public_html</main>');writeFileSync(join(publicRoot,'.htaccess'),'must not be served');
 const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../server/index.mjs',import.meta.url))],{cwd:privateApp,env:{...process.env,STATIC_ROOT:publicRoot,PORT:String(port),APP_ORIGIN:'http://127.0.0.1:'+port,DATABASE_PATH:join(privateApp,'.data/credits.sqlite'),NODE_ENV:'test',ALLOW_LIVE_PAYMENTS:'0',EMAIL_TRANSPORT:'disabled',ENABLE_DEV_INBOX:'0',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:''},stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',data=>{errors+=data;});
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Server failed: '+errors);})]);const origin='http://127.0.0.1:'+port;
  assert.match(await (await fetch(origin)).text(),/Independent public_html/);assert.equal((await fetch(origin+'/server/index.mjs')).status,404);assert.equal((await fetch(origin+'/.data/credits.sqlite')).status,404);assert.equal((await fetch(origin+'/.htaccess')).status,404);
  assert.equal(existsSync(join(privateApp,'.data/credits.sqlite')),true);assert.equal(existsSync(join(publicRoot,'.data')),false);
 }finally{child.kill('SIGTERM');if(child.exitCode===null)await once(child,'exit');rmSync(root,{recursive:true,force:true});}
});
