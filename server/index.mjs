import {createServer} from 'node:http';
import {mkdirSync} from 'node:fs';
import {Ledger} from './ledger.mjs';
import {handler} from './app.mjs';
mkdirSync('.data',{recursive:true,mode:0o700});
const ledger=new Ledger(process.env.DATABASE_PATH || '.data/credits.sqlite');
if (process.argv.includes('--create-account')) {
  // Run locally and store the returned development token securely. Never commit it.
  console.log(JSON.stringify(ledger.createAccount()));ledger.close();
} else {
  const origin=process.env.APP_ORIGIN || 'http://127.0.0.1:3002';
  const parsed=new URL(origin);
  if (!['http:','https:'].includes(parsed.protocol) || parsed.origin!==origin) throw Error('APP_ORIGIN must be an HTTP(S) origin with no trailing slash');
  const server=createServer(handler({ledger,origin,secretKey:process.env.STRIPE_SECRET_KEY,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET}));
  server.listen(Number(process.env.PORT || 3003),'127.0.0.1',()=>console.log('CoasterLab test credit API listening on loopback'));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{ledger.close();process.exit(0);}));
}
