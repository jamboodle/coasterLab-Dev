'use strict';
(async()=>{
  const el=id=>document.getElementById(id);
  const status=message=>{el('account-status').textContent=message;};
  let configured=false;
  async function request(path,options={}) {
    const response=await fetch(path,{...options,credentials:'same-origin',signal:AbortSignal.timeout(20000)});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error || 'Request failed. Try again.');
    return data;
  }
  function disconnected(){el('connected-account').hidden=true;el('account-login').hidden=false;el('account-balance').textContent='—';}
  async function refresh(){
    try{
      const data=await request('/api/balance');
      el('account-balance').textContent=data.credits;
      el('account-login').hidden=true;el('connected-account').hidden=false;
      el('test-checkout').disabled=!configured;
      return true;
    }catch(error){disconnected();status(error.message);return false;}
  }
  try{
    const config=await request('/api/config');
    if(!config.developmentLogin)return;
    configured=config.paymentsEnabled===true;
    el('test-account').hidden=false;
    const connected=await refresh();
    const result=new URLSearchParams(location.search).get('checkout');
    if(result==='returned')status('Returned from checkout. Credits appear only after verified payment confirmation. Refresh your balance if it is still pending.');
    else if(result==='canceled')status('Checkout canceled. No credits were added by returning to this page.');
    else status(connected?'Test account connected.': 'Connect a development account to begin.');
    if(!configured)status(el('account-status').textContent+' Stripe test payments are not configured.');
  }catch{return;}
  el('account-login').addEventListener('submit',async event=>{
    event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
    try{
      await request('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:el('account-token').value})});
      el('account-token').value='';
      if(await refresh())status('Test account connected.'+(configured?'':' Stripe test payments are not configured.'));
    }catch(error){el('account-token').value='';status(error.message);}finally{button.disabled=false;}
  });
  el('refresh-balance').addEventListener('click',async()=>{if(await refresh())status('Balance refreshed from the server.');});
  el('disconnect-account').addEventListener('click',async()=>{
    try{await request('/api/logout',{method:'POST'});disconnected();status('Disconnected.');}catch(error){status(error.message);}
  });
  el('test-checkout').addEventListener('click',async()=>{
    el('test-checkout').disabled=true;status('Opening Stripe test checkout…');
    try{
      const data=await request('/api/checkout',{method:'POST'});
      const url=new URL(data.url);
      if(url.protocol!=='https:' || url.hostname!=='checkout.stripe.com')throw Error('Invalid checkout destination.');
      location.assign(url.href);
    }catch(error){status(error.message);el('test-checkout').disabled=!configured;}
  });
})();
