import {proBilling, proLibrary, syncPro} from './pro.mjs';
import {createHash, createHmac, timingSafeEqual, randomUUID} from 'node:crypto';
import {paymentContext} from './payments.mjs';
import {exportRequest} from './exports.mjs';
import {adminRequest,publicSettings,creditPacks} from './admin.mjs';
import {credentials,passwordHash,passwordMatches} from './passwords.mjs';
export function verifyWebhook(body, signature, secret, now=Date.now()) {
  if (!secret || typeof signature !== 'string') return false;
  const parts=signature.split(',').map(x=>x.split('='));
  const timestamp=parts.find(([k])=>k==='t')?.[1];
  if (!/^\d+$/.test(timestamp || '') || Math.abs(now/1000-Number(timestamp))>300) return false;
  const expected=createHmac('sha256',secret).update(timestamp+'.').update(body).digest();
  return parts.some(([key,value])=>key==='v1' && /^[a-f0-9]{64}$/i.test(value || '') && timingSafeEqual(expected,Buffer.from(value,'hex')));
}
export function handler({ledger, secretKey, webhookSecret, origin, developmentLogin=false, customerAccounts=false, exportCreditTrial=false, secureExports=true, allowLivePayments=false, mailer=null, developmentInbox=false, onMailFailure=()=>{}, fetchImpl=fetch, artwork=null, resources=null, proPriceId,creditPackPriceIds={}}) {

  const emailEnabled=customerAccounts && typeof mailer?.send==='function';
  const sendChallenge=async(account,purpose)=>{
    const identity=ledger.identityForAccount(account);const token=ledger.issueChallenge(account,purpose);
    try{await mailer.send({to:identity.email,subject:purpose==='verify'?'Verify your CoasterPrint email':'Reset your CoasterPrint password',url:origin+'/account/#'+purpose+'='+token});}
    catch{onMailFailure({purpose});throw Error('Email submission failed');}
  };
  let activePasswordRequests=0;
  return async (req,res) => {
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      const settings=ledger.settings();
      const payments=paymentContext({settings,secretKey,webhookSecret,origin,allowLivePayments,developmentLogin,developmentInbox}),{mode,paymentsEnabled}=payments;
      const activeSecret=payments.credentials[mode].secret;
      const chargeExports=settings.billingEnabled || exportCreditTrial;
      const path=new URL(req.url,'http://localhost').pathname;
      if (resources && (path==='/api/resources' || path.startsWith('/api/resources/'))) return await resources.public(req,res,path,send);
      if (artwork && (path==='/api/artwork' || path.startsWith('/api/artwork/'))) return await artwork.public(req,res,path,send);
      if (req.method==='GET' && path==='/health') return send(200,{ok:true,paymentsEnabled:Boolean(paymentsEnabled),mode});
      if(req.method==='POST'&&['/api/webhooks/stripe','/api/webhooks/stripe/live'].includes(path)){
        const webhookMode=path.endsWith('/live')?'live':'test';
        if(!payments.configured(webhookMode)||(webhookMode==='live'&&!payments.productionOrigin)||(webhookMode==='test'&&payments.productionOrigin))return send(503,{error:'Payments are not configured for this endpoint.'});
        const chunks=[];let size=0;
        for await (const chunk of req) {size+=chunk.length;if(size>262144)return send(413,{error:'Payload too large'});chunks.push(chunk);}
        const body=Buffer.concat(chunks);
        if (!verifyWebhook(body,req.headers['stripe-signature'],payments.credentials[webhookMode].webhook)) return send(400,{error:'Invalid webhook signature'});
        let event;try {event=JSON.parse(body);} catch {return send(400,{error:'Invalid JSON'});}
        if (!event || typeof event.id!=='string' || !event.id || typeof event.type!=='string') return send(400,{error:'Invalid event'});
        ledger.creditPayment(event,webhookMode);
        await syncPro(ledger,event,webhookMode,payments.credentials[webhookMode].secret,fetchImpl);
        return send(200,{received:true});
      }
      const session=req.headers.cookie?.match(/(?:^|;\s*)cl_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      const bearer=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      const cookie=(value,age)=>res.setHeader('Set-Cookie',`cl_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${origin.startsWith('https:')?'; Secure':''}`);
      if(req.method==='GET' && path==='/api/maker-access'){const id=ledger.authenticate(bearer) || ledger.sessionAccount(session);if(id)ledger.touchVisit(id);return send(200,ledger.makerAccess(id,mode));}
      if (req.method==='GET' && path==='/api/config') return send(200,{developmentLogin,customerAccounts,paymentsEnabled:Boolean(paymentsEnabled),mode,emailEnabled,developmentInbox,secureExports,exportCreditTrial:chargeExports,exportLoginRequired:customerAccounts,...publicSettings(settings)});
      if (req.method==='POST' && path!=='/api/webhooks/stripe' && !bearer && req.headers.origin!==origin) return send(403,{error:'Origin rejected'});
      if(req.method==='GET' && path==='/api/dev/inbox') {
        const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        if(req.headers.host!==new URL(origin).host || (req.headers.origin && req.headers.origin!==origin) || !developmentInbox || !local || !['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname) || typeof mailer?.list!=='function')return send(404,{error:'Not found'});
        return send(200,{messages:mailer.list()});
      }
      if(req.method==='POST' && ['/api/recovery','/api/reset-password','/api/verify-email'].includes(path)) {
        if(!emailEnabled)return send(503,{error:'Email recovery and verification are not configured'});
        if(req.headers.origin!==origin)return send(403,{error:'Origin rejected'});
        if(!ledger.allowAuth('recovery:'+req.socket.remoteAddress))return send(429,{error:'Too many attempts. Try again in 15 minutes.'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return send(413,{error:'Payload too large'});}
        let body;try{body=JSON.parse(raw);}catch{return send(400,{error:'Invalid request'});}
        if(path==='/api/recovery') {
          const email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';
          if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return send(400,{error:'Enter a valid email address.'});
          const identity=ledger.identity(email);
          if(ledger.allowAuth('recovery-email:'+email) && identity){try{await sendChallenge(identity.account,'reset');}catch{}}
          return send(200,{message:'If an account exists, a password reset link has been sent.'});
        }
        if(path==='/api/verify-email') {
          if(!ledger.verifyEmail(body?.token))return send(400,{error:'This verification link is invalid or expired. Request a new link.'});
          return send(200,{ok:true});
        }
        if(typeof body?.password!=='string' || body.password.length<12 || body.password.length>128)return send(400,{error:'Use a password of 12 to 128 characters.'});
        if(!ledger.challenge(body?.token,'reset'))return send(400,{error:'This reset link is invalid or expired. Request a new link.'});
        if(activePasswordRequests>=4)return send(503,{error:'Account service is busy. Try again.'});
        activePasswordRequests++;
        try{
          const next=await passwordHash(body.password);
          if(!ledger.resetPassword(body.token,next.salt,next.digest))return send(400,{error:'This reset link is invalid or expired. Request a new link.'});
          cookie('',0);return send(200,{ok:true});
        }finally{activePasswordRequests--;}
      }
      if(req.method==='POST' && ['/api/register','/api/login'].includes(path)) {
        if(!customerAccounts)return send(404,{error:'Account sign-in is not enabled'});
        if(req.headers.origin!==origin)return send(403,{error:'Origin rejected'});
        if(!ledger.allowAuth(req.socket.remoteAddress || 'unknown')){
          res.setHeader('Retry-After','900');return send(429,{error:'Too many attempts. Try again in 15 minutes.'});
        }
        if(activePasswordRequests>=4)return send(503,{error:'Sign-in is busy. Please try again.'});
        activePasswordRequests++;
        try{
          let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return send(413,{error:'Payload too large'});}
          let parsed;try{parsed=JSON.parse(raw);}catch{return send(400,{error:'Invalid request'});}
          const input=credentials(parsed);
          if(!input)return send(400,{error:'Enter a valid email and a password of 12 to 128 characters.'});
          let id;
          if(path==='/api/register') {
            if(parsed.name!==undefined && (typeof parsed.name!=='string'||parsed.name.trim().length>80||/[\x00-\x1f\x7f]/.test(parsed.name)))return send(400,{error:'Use a name of up to 80 characters.'});
            const {salt,digest}=await passwordHash(input.password);
            id=ledger.registerIdentity(input.email,salt,digest,parsed.name?.trim() || '');
            if(!id)return send(409,{error:'An account already exists for this email. Sign in instead.'});
          }else{
            const identity=ledger.identity(input.email);
            if(!await passwordMatches(input.password,identity) || ledger.identity(input.email)?.digest!==identity?.digest)return send(401,{error:'Email or password is incorrect.'});
            id=identity.account;
          }
          if(ledger.control(id).suspended)return send(403,{error:'This account is suspended. Contact support.'});
          ledger.revokeSession(session);cookie(ledger.createSession(id),86400);
          let verificationSent=false;
          if(path==='/api/register' && emailEnabled){try{await sendChallenge(id,'verify');verificationSent=true;}catch{}}
          return send(path==='/api/register'?201:200,{ok:true,verificationSent,credits:ledger.balance(id)});
        }finally{activePasswordRequests--;}
      }
      if (req.method==='POST' && path==='/api/session') {
        if(!developmentLogin)return send(404,{error:'Development login disabled'});
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2048)return send(413,{error:'Payload too large'});}
        let token;try{token=JSON.parse(body)?.token;}catch{return send(400,{error:'Invalid request'});}
        const id=typeof token==='string' && /^[a-f0-9]{64}$/.test(token) ? ledger.authenticate(token) : undefined;
        if(!id)return send(401,{error:'Invalid development token'});
        ledger.revokeSession(session);
        cookie(ledger.createSession(id),86400);return send(200,{ok:true});
      }
      if(req.method==='POST' && path==='/api/logout') {
        ledger.revokeSession(session);cookie('',0);return send(200,{ok:true});
      }
      const account=ledger.authenticate(bearer) || ledger.sessionAccount(session);
      if (!account) return send(401,{error:'Authentication required'});
      ledger.touchVisit(account);
      if(req.method==='POST' && path==='/api/profile'){
        if(req.headers.origin!==origin)return send(403,{error:'Origin rejected'});
        if(!ledger.identityForAccount(account))return send(403,{error:'A registered account is required.'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)return send(413,{error:'Payload too large'});}
        let body;try{body=JSON.parse(raw);}catch{return send(400,{error:'Invalid request'});}
        if(typeof body?.name!=='string'||body.name.trim().length>80||/[\x00-\x1f\x7f]/.test(body.name))return send(400,{error:'Use a name of up to 80 characters.'});
        ledger.updateName(account,body.name.trim());return send(200,{ok:true});
      }
      if(path.startsWith('/api/pro/library/'))return await proLibrary({req,path,send,ledger,account,mode,origin});
      if(path==='/api/pro'||path.startsWith('/api/pro/')){
        const manageEnabled=payments.configured(mode)&&(mode==='live'?payments.liveAllowed:payments.testAllowed);
        return await proBilling({req,path,send,ledger,account,mode,enabled:paymentsEnabled&&customerAccounts,manageEnabled,secret:activeSecret,origin,fetchImpl,priceId:proPriceId});
      }
      if(path==='/api/exports'||path.startsWith('/api/exports/'))return await exportRequest({req,res,path,send,ledger,account,origin,billingEnabled:chargeExports,mode});
      if(path.startsWith('/api/admin/'))return adminRequest({req,path,send,ledger,account,origin,secretKey,webhookSecret,payments,artwork,resources});
      if(req.method==='POST' && ['/api/export-quote','/api/export-debit'].includes(path)) {
        if(secureExports)return send(410,{error:'Use the account-bound export preparation and download flow.'});
        if(!customerAccounts && !chargeExports)return send(404,{error:'Account exports are disabled'});
        if(req.headers.origin!==origin)return send(403,{error:'Origin rejected'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)return send(413,{error:'Payload too large'});}
        let body;try{body=JSON.parse(raw);}catch{return send(400,{error:'Invalid request'});}
        if(!body || typeof body.fingerprint!=='string' || !/^[a-f0-9]{64}$/.test(body.fingerprint) || !Number.isInteger(body.count) || body.count<1 || body.count>6)return send(400,{error:'Invalid export reference or coaster count'});
        if(!chargeExports || ledger.isPro(account,mode))return send(200,{cost:0,balance:ledger.balance(account),remaining:ledger.balance(account),retry:false,billingEnabled:false});
        const result=path==='/api/export-quote'?ledger.exportQuote(account,body.fingerprint,body.count):ledger.debitExport(account,body.fingerprint,body.count);
        if(result.error)return send(result.status,{error:result.error});
        return send(200,result);
      }
      if (req.method==='GET' && path==='/api/account') {
        const identity=ledger.identityForAccount(account);
        return send(200,{name:identity?.name || '',joinedAt:identity?.joined_at || null,lastVisitedAt:identity?.last_visited_at || null,maxImages:ledger.makerAccess(account,mode).maxImages,credits:ledger.balance(account),admin:Boolean(ledger.control(account).admin),email:identity?.email || null,passwordAccount:Boolean(identity),emailVerified:Boolean(identity?.verified_at),...(ledger.isPro(account,mode) && {pro:true}),activity:ledger.activity(account)});
      }
      if(req.method==='POST' && path==='/api/send-verification') {
        if(!emailEnabled)return send(503,{error:'Email verification is not configured'});
        if(req.headers.origin!==origin)return send(403,{error:'Origin rejected'});
        if(!ledger.allowAuth('verification:'+account))return send(429,{error:'Too many attempts. Try again later.'});
        const identity=ledger.identityForAccount(account);
        if(!identity)return send(400,{error:'A customer email account is required'});
        if(!identity.verified_at){try{await sendChallenge(account,'verify');}catch{return send(503,{error:'Email could not be sent right now. Please try again later.'});}}
        return send(200,{ok:true});
      }
      if(req.method==='POST' && path==='/api/logout-all') {
        if(!ledger.identityForAccount(account))return send(403,{error:'Use Disconnect for development-token accounts.'});
        if(req.headers.origin!==origin)return send(403,{error:'Origin rejected'});
        ledger.revokeAllSessions(account);cookie('',0);return send(200,{ok:true});
      }
      if(req.method==='POST' && path==='/api/password') {
        if(req.headers.origin!==origin)return send(403,{error:'Origin rejected'});
        if(!ledger.allowAuth(req.socket.remoteAddress || 'unknown'))return send(429,{error:'Too many attempts. Try again in 15 minutes.'});
        if(activePasswordRequests>=4)return send(503,{error:'Account service is busy. Try again.'});
        activePasswordRequests++;
        try{
          let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return send(413,{error:'Payload too large'});}
          let body;try{body=JSON.parse(raw);}catch{return send(400,{error:'Invalid request'});}
          if(!body || typeof body.currentPassword!=='string' || body.currentPassword.length>128 || typeof body.newPassword!=='string' || body.newPassword.length<12 || body.newPassword.length>128)return send(400,{error:'Enter your current password and a new password of 12 to 128 characters.'});
          const identity=ledger.identityForAccount(account);
          if(!await passwordMatches(body.currentPassword,identity))return send(401,{error:'Current password is incorrect.'});
          if(body.currentPassword===body.newPassword)return send(400,{error:'Choose a different password.'});
          const next=await passwordHash(body.newPassword);
          if((ledger.authenticate(bearer) || ledger.sessionAccount(session))!==account || !ledger.changePassword(account,identity.digest,next.salt,next.digest))return send(409,{error:'Account access changed. Sign in again.'});
          cookie(ledger.createSession(account),86400);return send(200,{ok:true});
        }finally{activePasswordRequests--;}
      }
      if (req.method==='GET' && path==='/api/balance') return send(200,{credits:ledger.balance(account)});
      if(req.method==='GET' && path==='/api/checkout-status') {
        const id=new URL(req.url,'http://localhost').searchParams.get('order');
        if(!id || !/^[a-f0-9]{32}$/.test(id))return send(400,{error:'Invalid checkout reference'});
        const state=ledger.orderStatus(account,id);
        return state ? send(200,{status:state}) : send(404,{error:'Checkout not found'});
      }
      if (req.method==='POST' && path==='/api/checkout') {
        if (!paymentsEnabled) return send(503,{error:'Credit purchases are currently unavailable.'});
        if (req.headers.origin && req.headers.origin!==origin) return send(403,{error:'Origin rejected'});
        const key=req.headers['idempotency-key'] || randomUUID();
        if(typeof key!=='string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(key))return send(400,{error:'Invalid checkout request key'});
        let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)return send(413,{error:'Payload too large'});}
        let input={};if(raw){try{input=JSON.parse(raw);}catch{return send(400,{error:'Invalid request'});}}
        if(!input || typeof input!=='object' || Array.isArray(input))return send(400,{error:'Invalid request'});
        const expectedMode=input.mode===undefined?'test':input.mode;
        if(expectedMode!==mode)return send(409,{error:'Payment mode changed. Reload the pricing page before starting checkout.',code:'checkout_mode_changed'});
        const selected=creditPacks(settings).find(pack=>pack.id===(input.pack===undefined?'starter':input.pack));
        if(!selected)return send(400,{error:'Choose a valid credit pack.'});
        const attempt=ledger.checkoutOrder(account,key,Date.now(),selected,mode);
        if(attempt.payment_mode!==mode)return send(409,{error:'This checkout reference belongs to a different payment mode. Reload the pricing page.',code:'checkout_mode_mismatch'});
        if(attempt.pack_id!==selected.id)return send(409,{error:'This checkout reference belongs to another pack. Try again.',code:'checkout_pack_mismatch'});
        const state=ledger.orderStatus(account,attempt.id);
        if(state==='confirmed')return send(409,{error:'This checkout is already confirmed. Refresh your balance.',code:'checkout_complete'});
        if(state==='expired')return send(409,{error:'Checkout attempt expired. Try again to start a new checkout.',code:'checkout_expired'});
        const order=attempt.id;
        const configuredPrice=creditPackPriceIds[attempt.pack_id];
        let managedPrice=attempt.managed_price;
        if(!attempt.session && !managedPrice && Object.values(creditPackPriceIds).some(Boolean)){
          if(!/^price_[A-Za-z0-9]+$/.test(configuredPrice || ''))return send(503,{error:'This credit pack is not configured for Stripe Managed Payments.'});
          const priceResponse=await fetchImpl('https://api.stripe.com/v1/prices/'+configuredPrice+'?expand%5B%5D=product',{
            headers:{Authorization:'Bearer '+activeSecret,'Stripe-Version':'2025-03-31.basil'},signal:AbortSignal.timeout(15000)
          });
          if(!priceResponse.ok)return send(502,{error:'Stripe could not read the configured credit-pack price.'});
          const price=await priceResponse.json();
          if(price.id!==configuredPrice || price.livemode!==(mode==='live') || price.active!==true ||
            price.type!=='one_time' || price.unit_amount!==attempt.amount || price.currency!==attempt.currency ||
            price.product?.active!==true || !/^txcd_\d{8}$/.test(price.product.tax_code || '')){
            return send(503,{error:'The Stripe credit-pack product needs a matching one-time price and a product tax code.'});
          }
          managedPrice=ledger.setCreditPackPrice(order,configuredPrice).managed_price;
        }
        const lineItem=managedPrice ? {'line_items[0][price]':managedPrice,'managed_payments[enabled]':'true'} :
          {'line_items[0][price_data][currency]':attempt.currency,'line_items[0][price_data][unit_amount]':String(attempt.amount),
            'line_items[0][price_data][product_data][name]':`CoasterPrint — ${attempt.credits} export credits${mode==='test'?' (test)':''}`};
        const form=new URLSearchParams({mode:'payment',...lineItem,'line_items[0][quantity]':'1',success_url:origin+'/pricing/?checkout=returned&order='+order+'&pack='+attempt.pack_id+'&paymentMode='+mode,cancel_url:origin+'/pricing/?checkout=canceled&order='+order+'&pack='+attempt.pack_id+'&paymentMode='+mode,expires_at:String(Math.floor((attempt.created_at+3600000)/1000)),'metadata[order_id]':order,'metadata[payment_mode]':mode,client_reference_id:order});
        const checkoutKey=managedPrice?createHash('sha256').update(order+':managed:'+managedPrice).digest('hex'):order;
        const response=await fetchImpl('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:'Bearer '+activeSecret,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':checkoutKey,...(managedPrice&&{'Stripe-Version':'2025-03-31.basil'})},body:form,signal:AbortSignal.timeout(15000)});
        if (!response.ok) return send(502,{error:'Checkout provider unavailable'});
        const session=await response.json();
        if (typeof session.id!=='string' || typeof session.url!=='string' || !session.url.startsWith('https://checkout.stripe.com/')) return send(502,{error:'Invalid checkout response'});
        if((mode==='live'&&session.livemode!==true)||(mode==='test'&&session.livemode===true))return send(502,{error:'Checkout provider returned the wrong payment mode.'});
        ledger.attachSession(order,session.id);
        return send(200,{url:session.url,order});
      }
      return send(404,{error:'Not found'});
    } catch {if (!res.headersSent)send(500,{error:'Request failed; retry later'});else res.end();}
  };
}
