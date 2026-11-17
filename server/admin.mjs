export async function jsonBody(req,limit=8192){
 let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>limit)throw Error('Request too large.');}
 const body=JSON.parse(raw);if(!body || typeof body!=='object' || Array.isArray(body))throw Error('Invalid request.');return body;
}
export function creditPacks(settings){return [{id:'starter',amount:settings.amount,credits:settings.credits},...settings.additionalPacks].map(pack=>({...pack,currency:settings.currency}));}
export function publicSettings(settings){
 return {billingEnabled:settings.billingEnabled,amount:settings.amount,credits:settings.credits,currency:settings.currency,packs:creditPacks(settings)};
}
export async function adminRequest({req,path,send,ledger,account,origin,secretKey,webhookSecret}){
 if(!ledger.control(account).admin || !ledger.identityForAccount(account))return send(403,{error:'Administrator access required.'});
 if(req.method==='POST' && req.headers.origin!==origin)return send(403,{error:'Origin rejected'});
 if(req.method==='GET' && path==='/api/admin/users'){
  const params=new URL(req.url,'http://localhost').searchParams;
  const offset=Number(params.get('offset') || 0),search=(params.get('search') || '').slice(0,254);
  if(!Number.isSafeInteger(offset)||offset<0)return send(400,{error:'Invalid page.'});
  return send(200,{users:ledger.users(search,offset)});
 }
 if(req.method==='GET' && path==='/api/admin/audit')return send(200,{entries:ledger.auditLog()});
 if(req.method==='GET' && path==='/api/admin/settings'){
  const settings=ledger.settings();return send(200,{...publicSettings(settings),secretKeyConfigured:Boolean(settings.secretKey || secretKey),webhookSecretConfigured:Boolean(settings.webhookSecret || webhookSecret),mode:'test'});
 }
 if(req.method!=='POST')return send(404,{error:'Not found'});
 try{
  const body=await jsonBody(req);
  if(path==='/api/admin/settings'){
   const allowed=['billingEnabled','amount','credits','currency','additionalPacks','secretKey','webhookSecret'];
   if(Object.keys(body).some(key=>!allowed.includes(key)))throw Error('Unknown setting.');
   if('billingEnabled' in body && typeof body.billingEnabled!=='boolean')throw Error('Billing must be on or off.');
   if('amount' in body && (!Number.isInteger(body.amount)||body.amount<50||body.amount>100000))throw Error('Price must be between $0.50 and $1,000.');
   if('credits' in body && (!Number.isInteger(body.credits)||body.credits<1||body.credits>10000))throw Error('Pack must contain 1 to 10,000 credits.');
   if('additionalPacks' in body){
    if(!Array.isArray(body.additionalPacks)||body.additionalPacks.length!==2)throw Error('Provide both additional credit packs.');
    for(const [index,pack] of body.additionalPacks.entries()){
     if(!pack||pack.id!==['standard','large'][index]||Object.keys(pack).some(key=>!['id','amount','credits'].includes(key))||!Number.isInteger(pack.amount)||pack.amount<50||pack.amount>100000||!Number.isInteger(pack.credits)||pack.credits<1||pack.credits>10000)throw Error('Each pack needs a price from $0.50 to $1,000 and 1 to 10,000 credits.');
    }
   }
   if('currency' in body && body.currency!=='usd')throw Error('Only USD is currently supported.');
   if('secretKey' in body && (typeof body.secretKey!=='string'||!/^sk_test_[A-Za-z0-9_]{4,240}$/.test(body.secretKey)))throw Error('Only Stripe test secret keys are supported until live billing is implemented.');
   if('webhookSecret' in body && (typeof body.webhookSecret!=='string'||!/^whsec_[A-Za-z0-9_]{4,240}$/.test(body.webhookSecret)))throw Error('Enter a valid webhook signing secret.');
   ledger.saveSettings(account,body);return send(200,{ok:true});
  }
  if(typeof body.account!=='string'||!/^[a-f0-9]{32}$/.test(body.account))throw Error('Invalid account.');
  if(path==='/api/admin/credits'){
   if(!Number.isInteger(body.delta)||body.delta===0||Math.abs(body.delta)>100000)throw Error('Enter a nonzero whole credit adjustment up to 100,000.');
   if(typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>300)throw Error('Enter a reason (3 to 300 characters).');
   if(typeof body.key!=='string'||!/^[a-f0-9-]{36}$/.test(body.key))throw Error('Invalid adjustment reference.');
   const credits=ledger.adjustCredits(account,body.account,body.delta,body.reason.trim(),body.key);return send(200,{credits});
  }
  if(path==='/api/admin/suspend'){
   if(typeof body.suspended!=='boolean')throw Error('Invalid suspension setting.');
   ledger.suspend(account,body.account,body.suspended);return send(200,{ok:true});
  }
  return send(404,{error:'Not found'});
 }catch(error){return send(400,{error:error.message==='Invalid JSON'?'Invalid request.':error instanceof SyntaxError?'Invalid request.':error.message});}
}
