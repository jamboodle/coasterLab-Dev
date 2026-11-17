'use strict';
(async()=>{
  const el=id=>document.getElementById(id);
  const status=message=>{el('account-status').textContent=message;};
  let pack={amount:500,credits:10,currency:'usd'},packs=[],selectedPack='starter',signedIn=false,configured=false,customerAccounts=false,developmentLogin=false,emailEnabled=false;
  let checkoutAttempt,pollTimer,pollGeneration=0;
  function stopPolling(){clearTimeout(pollTimer);pollGeneration++;}
  const returnedPack=new URLSearchParams(location.search).get('pack');if(['standard','large'].includes(returnedPack))selectedPack=returnedPack;
  let attemptStorage='coasterprint.checkoutAttempt'+(selectedPack==='starter'?'':'.'+selectedPack);
  function clearAttempt(){checkoutAttempt=undefined;try{sessionStorage.removeItem(attemptStorage);if(selectedPack==='starter')sessionStorage.removeItem('coasterlab.checkoutAttempt');}catch{}}
  function requestKey(){
    if(!checkoutAttempt){try{checkoutAttempt=sessionStorage.getItem(attemptStorage) || (selectedPack==='starter'?sessionStorage.getItem('coasterlab.checkoutAttempt'):null);}catch{}}
    if(!checkoutAttempt || !/^[a-zA-Z0-9_-]{16,100}$/.test(checkoutAttempt))checkoutAttempt=crypto.randomUUID();
    try{sessionStorage.setItem(attemptStorage,checkoutAttempt);if(selectedPack==='starter')sessionStorage.removeItem('coasterlab.checkoutAttempt');}catch{}
    return checkoutAttempt;
  }
  async function request(path,options={}) {
    const response=await fetch(path,{...options,credentials:'same-origin',signal:AbortSignal.timeout(20000)});
    const data=await response.json();
    if(!response.ok){const error=new Error(data.error || 'Request failed. Try again.');error.code=data.code;throw error;}
    return data;
  }
  function setAuthMode(mode){
    const register=mode==='register';
    el('auth-signin').setAttribute('aria-pressed',String(!register));
    el('auth-register').setAttribute('aria-pressed',String(register));
    el('customer-signin').hidden=register;el('customer-register').hidden=!register;
    el('registration-hint').hidden=!register;
    el('customer-password').autocomplete=register?'new-password':'current-password';
    el('customer-password').value='';
  }
  function checkoutState(connected){
    signedIn=connected;
    el('test-checkout').disabled=!configured || !signedIn;
    el('test-checkout').textContent=!configured?'Purchases unavailable':signedIn?`Open test checkout · $${(pack.amount/100).toFixed(2)} / ${pack.credits} credits`:'Sign in to use test checkout';
    el('purchase-hint').textContent=!configured?'Purchases are not available yet. No live payments are collected.':'Test checkout only. No real money will be charged.';
  }
  function unavailable(){el('account-unavailable').textContent='Account services are unavailable in this preview. You can still use the maker.';checkoutState(false);}
  setAuthMode('signin');
  el('auth-signin').addEventListener('click',()=>setAuthMode('signin'));
  el('auth-register').addEventListener('click',()=>setAuthMode('register'));
  function disconnected(){stopPolling();setAuthMode('signin');checkoutState(false);el('account-description').textContent='Sign in to see your credits and manage your account.';el('connected-account').hidden=true;el('account-login').hidden=!developmentLogin;el('customer-login').hidden=!customerAccounts;el('account-balance').textContent='—';}
  async function refresh(){
    try{
      const data=await request('/api/account');
      el('account-balance').textContent=data.credits;el('admin-link').hidden=!data.admin;
      el('account-security').hidden=!data.passwordAccount;
      el('signout-everywhere').hidden=!data.passwordAccount;
      el('account-email').textContent=data.email || 'Development test account';
      el('account-description').textContent='Your balance and account settings, all in one place.';
      el('email-verification-status').textContent=data.passwordAccount?(data.emailVerified?'Email verified.':'Your email has not been verified yet.'):'';
      el('send-verification').hidden=!data.passwordAccount || data.emailVerified || !emailEnabled;
      const history=el('account-activity');history.replaceChildren();
      for(const entry of data.activity){const item=document.createElement('li');item.textContent=(entry.delta>0?'+':'')+entry.delta+' credits · '+({purchase:'Credit purchase',export_trial:'3MF export',test_grant:'Test credits',welcome:'Welcome credits',admin_adjustment:'Admin adjustment'}[entry.kind] || entry.kind);history.append(item);}
      if(!data.activity.length){const item=document.createElement('li');item.textContent='No credit activity yet.';history.append(item);}
      el('account-login').hidden=true;el('customer-login').hidden=true;el('connected-account').hidden=false;
      checkoutState(true);
      return true;
    }catch(error){disconnected();status(error.message);return false;}
  }
  try{
    const config=await request('/api/config');
    customerAccounts=config.customerAccounts===true;developmentLogin=config.developmentLogin===true;
    if(!developmentLogin && !customerAccounts){unavailable();return;}
    el('welcome-hint').textContent=config.welcomeCredits>0?`Start with ${config.welcomeCredits} free credits.`:'';el('welcome-description').textContent=config.welcomeCredits>0?`New accounts start with ${config.welcomeCredits} credits.`:'';
    packs=config.packs;pack=packs.find(pack=>pack.id===selectedPack);
    el('pack-options').replaceChildren();const legend=document.createElement('legend');legend.textContent='Choose your credit pack';el('pack-options').append(legend);
    for(const option of packs){const label=document.createElement('label');label.className='pack-choice';const radio=document.createElement('input');radio.type='radio';radio.name='credit-pack';radio.value=option.id;radio.checked=option.id===selectedPack;const credits=document.createElement('span');credits.textContent=option.credits+' credits';const price=document.createElement('strong');price.textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:option.currency}).format(option.amount/100)+' USD';if(option.id==='starter'){credits.id='pack-credits';price.id='pack-price';}label.append(radio,credits,price);el('pack-options').append(label);radio.addEventListener('change',()=>{if(!radio.checked)return;selectedPack=option.id;pack=option;checkoutAttempt=undefined;attemptStorage='coasterprint.checkoutAttempt'+(selectedPack==='starter'?'':'.'+selectedPack);checkoutState(signedIn);});}
    configured=config.paymentsEnabled===true;emailEnabled=config.emailEnabled===true;
    el('recovery-link').hidden=!customerAccounts || !emailEnabled;el('test-inbox-link').hidden=!config.developmentInbox;
    el('account-unavailable').hidden=true;el('test-account').hidden=false;
    checkoutState(false);
    el('account-login').hidden=true;el('customer-login').hidden=true;
    status('Loading your account…');
    const connected=await refresh();
    const result=new URLSearchParams(location.search).get('checkout');
    if(result==='returned'){
      status('Returned from checkout. Credits appear only after verified payment confirmation. Refresh your balance if it is still pending.');
      const order=new URLSearchParams(location.search).get('order');
      if(connected && order && /^[a-f0-9]{32}$/.test(order)){
        const generation=pollGeneration;
        const check=async()=>{
          try{
            const result=await request('/api/checkout-status?order='+order);
            if(generation!==pollGeneration)return true;
            if(result.status==='confirmed'){clearAttempt();await refresh();status('Payment confirmed. Your credits are ready.');return true;}
            if(result.status==='expired'){clearAttempt();status('This checkout has expired. Refresh your balance before starting another purchase.');return true;}
            status('Payment confirmation is pending. Your credits will appear after the payment provider confirms it.');
          }catch{if(generation===pollGeneration)status('Could not check payment confirmation. Refresh your balance or try again later.');return true;}
          return false;
        };
        if(!await check()){
          let checks=0;
          const poll=async()=>{if(generation!==pollGeneration)return;if(await check())return;if(++checks<6)pollTimer=setTimeout(poll,3000);};
          pollTimer=setTimeout(poll,3000);
          addEventListener('pagehide',stopPolling,{once:true});
        }
      }
    }
    else if(result==='canceled')status('Checkout canceled. No credits were added by returning to this page.');
    else if(connected)status(`Signed in. You have ${el('account-balance').textContent} credits.`);else status('');
    if(!connected && new URLSearchParams(location.search).get('register')==='1')setAuthMode('register');

  }catch{unavailable();return;}
  el('customer-login').addEventListener('submit',async event=>{
    event.preventDefault();
    const buttons=[el('customer-signin'),el('customer-register')];buttons.forEach(button=>button.disabled=true);
    const register=event.submitter?.id==='customer-register';
    status(register?'Creating your account…':'Signing in…');
    try{
      const accountResult=await request(register?'/api/register':'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:el('customer-email').value,password:el('customer-password').value})});
      el('customer-password').value='';
      if(await refresh())status(register?(emailEnabled?(accountResult.verificationSent?'Account created. Verification email sent.':'Account created. Email could not be sent; use Send verification link to try again.'):'Account created.'):`Signed in. You have ${accountResult.credits} credits.`);
    }catch(error){el('customer-password').value='';status(error.message);}finally{buttons.forEach(button=>button.disabled=false);}
  });
  el('account-login').addEventListener('submit',async event=>{
    event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
    try{
      await request('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:el('account-token').value})});
      el('account-token').value='';
      if(await refresh())status('Test account connected.');
    }catch(error){el('account-token').value='';status(error.message);}finally{button.disabled=false;}
  });
  el('refresh-balance').addEventListener('click',async()=>{if(await refresh())status('Balance refreshed from the server.');});
  el('disconnect-account').addEventListener('click',async()=>{
    try{await request('/api/logout',{method:'POST'});clearAttempt();disconnected();status(customerAccounts?'Signed out.':'Disconnected.');}catch(error){status(error.message);}
  });
  el('send-verification').addEventListener('click',async()=>{
    el('send-verification').disabled=true;
    try{await request('/api/send-verification',{method:'POST'});status('Verification link sent. Check your inbox.');}catch(error){status(error.message);}finally{el('send-verification').disabled=false;}
  });
  el('password-change').addEventListener('submit',async event=>{
    event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
    try{
      await request('/api/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:el('current-password').value,newPassword:el('new-password').value})});
      status('Password changed. Other sessions have been signed out.');
    }catch(error){status(error.message);}finally{event.target.reset();button.disabled=false;}
  });
  el('signout-everywhere').addEventListener('click',async()=>{
    try{await request('/api/logout-all',{method:'POST'});el('password-change').reset();clearAttempt();disconnected();status('Signed out everywhere.');}catch(error){status(error.message);}
  });
  el('test-checkout').addEventListener('click',async()=>{
    el('test-checkout').disabled=true;status('Opening Stripe test checkout…');
    try{
      const data=await request('/api/checkout',{method:'POST',headers:{'Idempotency-Key':requestKey(),'Content-Type':'application/json'},body:JSON.stringify({pack:selectedPack})});
      const url=new URL(data.url);
      if(url.protocol!=='https:' || url.hostname!=='checkout.stripe.com')throw Error('Invalid checkout destination.');
      location.assign(url.href);
    }catch(error){if(['checkout_complete','checkout_expired','checkout_pack_mismatch'].includes(error.code)){clearAttempt();await refresh();}status(error.message);el('test-checkout').disabled=!configured;}
  });
})();
