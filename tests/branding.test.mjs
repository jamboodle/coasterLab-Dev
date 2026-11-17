import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {withStatic} from '../server/static.mjs';
import {accountMessage} from '../server/sendmail.mjs';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
test('public pages and generated export branding use CoasterPrint',()=>{
 for(const name of ['index.html','pricing/index.html','account/index.html','dev/inbox/index.html']){
  const page=readFileSync(root+name,'utf8');assert.match(page,/CoasterPrint/);assert.doesNotMatch(page,/coasterlab/i);
 }
 const manifest=JSON.parse(readFileSync(root+'asset-manifest.json','utf8'));
 assert.equal(manifest.build,'coasterprint-r27');
 for(const name of ['app.js','worker.js','export-codec.js','stl-geometry.js'])assert.match(readFileSync(root+manifest.scripts[name],'utf8'),/CoasterPrint|COASTERPRINT|coasterprint/);
 for(const name of readdirSync(root+'downloads'))assert.doesNotMatch(name,/coasterlab/i);
});
test('account email names, subjects and message text are rebranded',()=>{
 const email=accountMessage({from:'noreply@coasterprint.com',to:'maker@example.com',subject:'Verify your CoasterPrint email',url:'https://coasterprint.com/account/#verify='+'a'.repeat(64),origin:'https://coasterprint.com'});
 const [headers,body]=email.split('\r\n\r\n');
 assert.match(headers,/From: CoasterPrint <noreply@coasterprint.com>/);
 const text=Buffer.from(body,'base64').toString('utf8');assert.match(text,/Welcome to CoasterPrint/);assert.match(text,/https:\/\/coasterprint.com/);assert.doesNotMatch(text,/coasterlab/i);
 const app=readFileSync(new URL('../server/app.mjs',import.meta.url),'utf8');
 assert.match(app,/Verify your CoasterPrint email/);assert.match(app,/Reset your CoasterPrint password/);
});
test('old release and holder-download links redirect to the new filenames',async()=>{
 const server=createServer(withStatic((_req,res)=>{res.writeHead(404);res.end();},root));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 try{
  for(const [old,target] of [['/coasterlab-r27.html','/coasterprint-r27.html'],['/downloads/coasterlab-holder-pack.zip','/downloads/coasterprint-holder-pack.zip']]){
   const response=await fetch(origin+old,{redirect:'manual'});assert.equal(response.status,308);assert.equal(response.headers.get('location'),target);
   assert.equal((await fetch(origin+target)).status,200);
  }
 }finally{await new Promise(r=>server.close(r));}
});
