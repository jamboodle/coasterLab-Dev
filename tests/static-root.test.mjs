import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {createServer as httpServer} from 'node:http';
import {withStatic} from '../server/static.mjs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('server uses public_html for public assets while its database stays in the private app directory',{timeout:15000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'coasterprint-account-')),privateApp=join(root,'app'),publicRoot=join(root,'public_html');mkdirSync(privateApp);mkdirSync(publicRoot);
 writeFileSync(join(publicRoot,'asset-manifest.json'),JSON.stringify({scripts:{}}));writeFileSync(join(publicRoot,'index.html'),'<main id="maker"><input id="files">Independent public_html</main>');writeFileSync(join(publicRoot,'.htaccess'),'must not be served');
 const verification='google1234567890abcdef.html',verificationBody='google-site-verification: '+verification;
 writeFileSync(join(publicRoot,verification),verificationBody);
 const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../server/index.mjs',import.meta.url))],{cwd:privateApp,env:{...process.env,STATIC_ROOT:publicRoot,PORT:String(port),APP_ORIGIN:'http://127.0.0.1:'+port,DATABASE_PATH:join(privateApp,'.data/credits.sqlite'),NODE_ENV:'test',ALLOW_LIVE_PAYMENTS:'0',EMAIL_TRANSPORT:'disabled',ENABLE_DEV_INBOX:'0',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:''},stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',data=>{errors+=data;});
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Server failed: '+errors);})]);const origin='http://127.0.0.1:'+port;
  const home=await fetch(origin);assert.equal(home.headers.get('x-robots-tag'),'noindex');assert.match(await home.text(),/Independent public_html/);assert.equal((await fetch(origin+'/server/index.mjs')).status,404);assert.equal((await fetch(origin+'/.data/credits.sqlite')).status,404);assert.equal((await fetch(origin+'/.htaccess')).status,404);
  const verified=await fetch(origin+'/'+verification,{redirect:'manual'});assert.equal(verified.status,200);assert.equal(await verified.text(),verificationBody);
  const head=await fetch(origin+'/'+verification,{method:'HEAD',redirect:'manual'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await fetch(origin+'/googleabcdef.html',{redirect:'manual'})).status,404);
  const retired=await fetch(origin+'/old-maker.html',{redirect:'manual'});assert.equal(retired.status,308);assert.equal(retired.headers.get('location'),'/');
  assert.equal(existsSync(join(privateApp,'.data/credits.sqlite')),true);assert.equal(existsSync(join(publicRoot,'.data')),false);
 }finally{child.kill('SIGTERM');if(child.exitCode===null)await once(child,'exit');rmSync(root,{recursive:true,force:true});}
});

test('production sitemap lists canonical public pages and keeps account pages out',async()=>{
 const root=fileURLToPath(new URL('../dist/',import.meta.url));
 const server=httpServer(withStatic((_req,res)=>res.end(),root));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 try{
  const robots=await fetch(origin+'/robots.txt');
  assert.match(robots.headers.get('content-type'),/^text\/plain/);
  assert.match(await robots.text(),/Sitemap: https:\/\/coasterprint\.com\/sitemap\.xml/);
  const sitemap=await fetch(origin+'/sitemap.xml');
  assert.match(sitemap.headers.get('content-type'),/^application\/xml/);
  const urls=[...(await sitemap.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map(match=>match[1]);
  assert.equal(urls.length,8);
  for(const url of urls){
   assert.equal(new URL(url).origin,'https://coasterprint.com');
   const page=await fetch(origin+new URL(url).pathname,{redirect:'manual'});
   assert.equal(page.status,200,url);
   assert.equal(page.headers.get('x-robots-tag'),null);
   const html=await page.text();
   assert.ok(html.includes('<link rel="canonical" href="'+url+'">'),url);
   assert.match(html,/<meta name="description" content="[^"]+"/);
   assert.doesNotMatch(html,/<meta name="robots" content="noindex">/);
  }
  for(const path of ['/admin/','/account/','/suncatcher/','/artwork/','/dev/inbox/']){
   assert.match(await (await fetch(origin+path)).text(),/<meta name="robots" content="noindex">/);
  }
  for(const [maker,guide,anchor] of [['/','image-to-coaster','upload-artwork'],
   ['/plaque/','image-to-plaque','trace-title'],['/cookie-cutter/','image-to-cookie-cutter','outline-title']]){
   const path='/guides/'+guide+'/';
   assert.ok((await (await fetch(origin+maker)).text()).includes('href="'+path+'"'));
   assert.ok((await (await fetch(origin+path)).text()).includes('href="'+maker+'#'+anchor+'"'));
  }
 }finally{await new Promise(resolve=>server.close(resolve));}
});
