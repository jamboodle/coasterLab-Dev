import {readFileSync} from 'node:fs';
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,extname,sep,normalize} from 'node:path';
const types={'.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8','.ico':'image/vnd.microsoft.icon','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.zip':'application/zip'};
export function withStatic(api, root, {indexable = true} = {}) {
  root=resolve(root);
  const current=new Set(Object.values(JSON.parse(readFileSync(resolve(root,'asset-manifest.json'),'utf8')).scripts));
  for(const file of ['maker-account.js'])current.add(file);
  return async(req,res)=>{
    const parsed=new URL(req.url,'http://localhost');let pathname;try{pathname=normalize(decodeURIComponent(parsed.pathname));}catch{res.writeHead(400);return res.end('Invalid path');}
    if(/^\/(?:downloads\/)?coasterlab[-.a-z0-9]*\.(?:html|zip)$/i.test(pathname)){
      res.writeHead(308,{Location:pathname.replace(/coasterlab/i,'coasterprint')+parsed.search});return res.end();
    }
    if(pathname.split('/').some(part=>part.startsWith('.')&&part!=='.well-known')){res.writeHead(404);return res.end('Not found');}
    if(pathname.startsWith('/api/') || pathname==='/health')return api(req,res);
    const googleVerification=/^\/google[a-f0-9]+\.html$/.test(pathname);
    if(/^\/[^/]+\.html$/i.test(pathname)&&pathname!=='/index.html'&&!googleVerification){res.writeHead(308,{Location:'/'});return res.end();}
    if((/^\/[^/]+\.js$/i.test(pathname)&&!current.has(pathname.slice(1)))||(/^\/downloads\/.*\.zip$/i.test(pathname)&&pathname!=='/downloads/coasterprint-holder-pack.zip')){res.writeHead(410,{'Cache-Control':'no-store'});return res.end('This historical release has been retired. Use the current maker.');}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
    try{
      let path=resolve(root,'.'+pathname);
      if(path!==root && !path.startsWith(root+sep))throw Error();
      if((await stat(path)).isDirectory()){
        if(!pathname.endsWith('/')){res.writeHead(301,{Location:pathname+'/'});return res.end();}
        path=resolve(path,'index.html');
      }
      path=await realpath(path);
      if(!path.startsWith(root+sep))throw Error();
      const data=await readFile(path);
      const extension=extname(path);
      res.writeHead(200,{'Content-Type':types[extension] || 'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache',
        ...(!indexable && extension==='.html' && {'X-Robots-Tag':'noindex'})});
      res.end(req.method==='HEAD'?undefined:data);
    }catch{res.writeHead(404);res.end('Not found');}
  };
}
