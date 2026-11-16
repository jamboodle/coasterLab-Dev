import {createHmac, timingSafeEqual} from 'node:crypto';
export function verifyWebhook(body, signature, secret, now=Date.now()) {
  if (!secret || typeof signature !== 'string') return false;
  const parts=signature.split(',').map(x=>x.split('='));
  const timestamp=parts.find(([k])=>k==='t')?.[1];
  if (!/^\d+$/.test(timestamp || '') || Math.abs(now/1000-Number(timestamp))>300) return false;
  const expected=createHmac('sha256',secret).update(timestamp+'.').update(body).digest();
  return parts.some(([key,value])=>key==='v1' && /^[a-f0-9]{64}$/i.test(value || '') && timingSafeEqual(expected,Buffer.from(value,'hex')));
}
export function handler({ledger, secretKey, webhookSecret, origin, developmentLogin=false, fetchImpl=fetch}) {
  const paymentsEnabled=secretKey?.startsWith('sk_test_') && Boolean(webhookSecret);
  return async (req,res) => {
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      const path=new URL(req.url,'http://localhost').pathname;
      if (req.method==='GET' && path==='/health') return send(200,{ok:true,paymentsEnabled:Boolean(paymentsEnabled),mode:'test'});
      if (req.method==='POST' && path==='/api/webhooks/stripe') {
        if (!paymentsEnabled) return send(503,{error:'Test payments are not configured'});
        const chunks=[];let size=0;
        for await (const chunk of req) {size+=chunk.length;if(size>262144)return send(413,{error:'Payload too large'});chunks.push(chunk);}
        const body=Buffer.concat(chunks);
        if (!verifyWebhook(body,req.headers['stripe-signature'],webhookSecret)) return send(400,{error:'Invalid webhook signature'});
        let event;try {event=JSON.parse(body);} catch {return send(400,{error:'Invalid JSON'});}
        if (typeof event.id!=='string' || !event.id || typeof event.type!=='string') return send(400,{error:'Invalid event'});
        ledger.creditPayment(event);
        return send(200,{received:true});
      }
      const session=req.headers.cookie?.match(/(?:^|;\s*)cl_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      const bearer=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      const cookie=(value,age)=>res.setHeader('Set-Cookie',`cl_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${origin.startsWith('https:')?'; Secure':''}`);
      if (req.method==='GET' && path==='/api/config') return send(200,{developmentLogin,paymentsEnabled:Boolean(paymentsEnabled),mode:'test'});
      if (req.method==='POST' && path!=='/api/webhooks/stripe' && !bearer && req.headers.origin!==origin) return send(403,{error:'Origin rejected'});
      if (req.method==='POST' && path==='/api/session') {
        if(!developmentLogin)return send(404,{error:'Development login disabled'});
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2048)return send(413,{error:'Payload too large'});}
        let token;try{token=JSON.parse(body).token;}catch{return send(400,{error:'Invalid request'});}
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
      if (req.method==='GET' && path==='/api/balance') return send(200,{credits:ledger.balance(account)});
      if (req.method==='POST' && path==='/api/checkout') {
        if (!paymentsEnabled) return send(503,{error:'Test payments are not configured'});
        if (req.headers.origin && req.headers.origin!==origin) return send(403,{error:'Origin rejected'});
        const order=ledger.createOrder(account);
        const form=new URLSearchParams({mode:'payment','line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':'500','line_items[0][price_data][product_data][name]':'CoasterLab — 10 export credits (test)','line_items[0][quantity]':'1',success_url:origin+'/pricing/?checkout=returned',cancel_url:origin+'/pricing/?checkout=canceled','metadata[order_id]':order});
        const response=await fetchImpl('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:'Bearer '+secretKey,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':order},body:form,signal:AbortSignal.timeout(15000)});
        if (!response.ok) return send(502,{error:'Checkout provider unavailable'});
        const session=await response.json();
        if (typeof session.id!=='string' || typeof session.url!=='string' || !session.url.startsWith('https://checkout.stripe.com/')) return send(502,{error:'Invalid checkout response'});
        ledger.attachSession(order,session.id);
        return send(200,{url:session.url});
      }
      return send(404,{error:'Not found'});
    } catch {if (!res.headersSent)send(500,{error:'Request failed; retry later'});else res.end();}
  };
}
