import {createServer} from 'node:http';
import {mkdirSync} from 'node:fs';
import {Ledger} from './ledger.mjs';
import {handler} from './app.mjs';
import {withStatic} from './static.mjs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {artworkLibrary} from './artwork.mjs';
import {configureMailer} from './mail-config.mjs';
mkdirSync('.data',{recursive:true,mode:0o700});
const databasePath=process.env.DATABASE_PATH || '.data/credits.sqlite';
const ledger=new Ledger(databasePath);
if(process.argv.includes('--make-admin')) {
  const email=process.argv[process.argv.indexOf('--make-admin')+1];
  if(!email)throw Error('Supply the registered administrator email.');
  ledger.makeAdmin(email);console.log('Administrator access granted. Sign in again at /admin/.');ledger.close();
} else if(process.argv.includes('--grant-test-credits')) {
  if(process.env.ENABLE_EXPORT_CREDIT_TRIAL!=='1')throw Error('Enable the export credit trial before granting test credits');
  const position=process.argv.indexOf('--grant-test-credits');
  const identity=ledger.identity((process.argv[position+1] || '').trim().toLowerCase());
  if(!identity)throw Error('Customer account not found');
  ledger.grantTestCredits(identity.account,Number(process.argv[position+2] || 10));
  console.log('Test credits added.');ledger.close();
} else if (process.argv.includes('--create-account')) {
  // Run locally and store the returned development token securely. Never commit it.
  console.log(JSON.stringify(ledger.createAccount()));ledger.close();
} else {
  const origin=process.env.APP_ORIGIN || 'http://127.0.0.1:3003';
  const parsed=new URL(origin);
  if (!['http:','https:'].includes(parsed.protocol) || parsed.origin!==origin) throw Error('APP_ORIGIN must be an HTTP(S) origin with no trailing slash');
  const {mailer,developmentInbox}=configureMailer(process.env,origin);
  const staticRoot=process.env.STATIC_ROOT || fileURLToPath(new URL('../dist/',import.meta.url));
  const resources=artworkLibrary({dataDir:dirname(databasePath),resourceRoot:join(staticRoot,'resource-images'),key:process.env.OPENAI_API_KEY});
  const artwork=artworkLibrary({dataDir:dirname(databasePath),key:process.env.OPENAI_API_KEY});
  const server=createServer(withStatic(handler({ledger,origin,artwork,resources,proPriceId:process.env.STRIPE_PRO_PRICE_ID,onMailFailure:()=>console.error('Account email submission failed; check the mail service.'),mailer,developmentInbox,developmentLogin:process.env.ENABLE_DEV_LOGIN==='1',allowLivePayments:process.env.ALLOW_LIVE_PAYMENTS==='1'&&process.env.NODE_ENV==='production',customerAccounts:process.env.ENABLE_CUSTOMER_ACCOUNTS==='1',secretKey:process.env.STRIPE_SECRET_KEY,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET}),staticRoot));
  server.listen(Number(process.env.PORT || 3003),'127.0.0.1',()=>console.log('CoasterPrint test credit API listening on loopback'));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{ledger.close();process.exit(0);}));
}
