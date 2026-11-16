'use strict';
(async()=>{
 const el=id=>document.getElementById(id);
 addEventListener('hashchange',()=>{if(/^#(?:reset|verify)=/.test(location.hash))location.reload();});
 const params=new URLSearchParams(location.hash.slice(1));
 const resetToken=params.get('reset'),verifyToken=params.get('verify');
 if(location.hash)history.replaceState(null,'',location.pathname+location.search);
 const status=message=>el('help-status').textContent=message;
 async function api(path,body){
  const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok)throw Error(data.error || 'Request failed. Try again.');return data;
 }
 try{
  const response=await fetch('/api/config',{signal:AbortSignal.timeout(10000)});const config=await response.json();
  if(!response.ok || !config.emailEnabled){status('Email verification and recovery are not configured in this environment.');return;}
  el('local-inbox').hidden=!config.developmentInbox;
  if(resetToken){el('page-title').textContent='Choose a new password.';el('help-description').textContent='This link can be used once and expires after 30 minutes.';el('reset-form').hidden=false;status('Enter a new password below.');}
  else if(verifyToken){el('page-title').textContent='Verify your email.';el('help-description').textContent='Confirm that this email address belongs to you. This link can be used once and expires after 24 hours.';el('verify-email').hidden=false;status('Select Verify my email to confirm.');}
  else{el('recovery-form').hidden=false;status('Enter the email address you used to register.');}
 }catch{status('Account services are unavailable. Please try again later.');return;}
 el('recovery-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
  try{const result=await api('/api/recovery',{email:el('recovery-email').value});status(result.message);}catch(error){status(error.message);}finally{button.disabled=false;}
 });
 el('reset-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
  try{await api('/api/reset-password',{token:resetToken,password:el('reset-password').value});el('reset-form').hidden=true;status('Password reset. All sessions have been signed out. You can sign in with your new password.');}catch(error){status(error.message);}finally{el('reset-password').value='';button.disabled=false;}
 });
 el('verify-email').addEventListener('click',async()=>{
  el('verify-email').disabled=true;
  try{await api('/api/verify-email',{token:verifyToken});el('verify-email').hidden=true;status('Email verified. Return to your account to continue.');}catch(error){status(error.message);el('verify-email').disabled=false;}
 });
})();
