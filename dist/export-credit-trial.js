'use strict';
(()=>{
 let mode,preparing=false;
 const configuration=fetch('/api/config',{credentials:'same-origin',signal:AbortSignal.timeout(10000)}).then(async response=>{
  if(response.status===404)return mode=false;
  if(!response.ok)throw Error('Export settings are unavailable. Reload and try again.');
  return mode=(await response.json()).exportCreditTrial===true;
 });
 // The promise is checked again on export; avoid an unhandled rejection while offline.
 configuration.catch(()=>{});
 const save=(url,name)=>{const link=document.createElement('a');link.href=url;link.download=name;link.click();};
 function panel(){
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-labelledby','export-credit-title');
  dialog.className='export-credit-dialog';
  dialog.innerHTML='<form method="dialog"><button class="dialog-close" aria-label="Close export confirmation">×</button></form><p class="eyebrow">TEST EXPORT</p><h2 id="export-credit-title">3MF credit trial</h2><p>Test credits only. No money will be charged.</p><p data-summary></p><p data-message role="status" aria-live="polite"></p><div class="dialog-actions"><button data-authorize>Confirm test credits</button><button class="download-ready" data-save hidden>Download Ready</button></div><p><a href="pricing/" target="_blank" rel="noopener">Account & credits (opens a new tab)</a></p><details><summary>About test credits & retries</summary><p>This trial covers direct 3MF downloads. Other formats remain free. Retrying these exact file bytes uses the original debit. A regenerated file may count as a new export. Keep this page open if you need to retry a download.</p></details>';
  document.body.append(dialog);return dialog;
 }
 async function api(path,body){
  const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(!response.ok)throw Error(response.status===401?'Sign in to your account, then try this export again.':data.error || 'Credit service unavailable. Retry with the same file.');
  return data;
 }
 window.creditTrialDownload=async(url,name,count)=>{
  if(mode===false){save(url,name);return;}
  if(preparing)return;
  preparing=true;
  let dialog,localUrl;
  try{
   if(!await configuration){save(url,name);return;}
   dialog=panel();dialog.showModal();
   const summary=dialog.querySelector('[data-summary]'),message=dialog.querySelector('[data-message]'),authorize=dialog.querySelector('[data-authorize]'),ready=dialog.querySelector('[data-save]');
   authorize.disabled=true;message.textContent='Checking your ready file and balance…';
   dialog.addEventListener('close',()=>{if(localUrl)URL.revokeObjectURL(localUrl);dialog.remove();preparing=false;},{once:true});
   // Read the already generated local file before any debit. No image/model bytes are uploaded.
   const response=await fetch(url);if(!response.ok)throw Error('The ready file is no longer available. Rebuild it first.');
   const blob=await response.blob();if(!blob.size)throw Error('The generated file is empty. No credits were used.');
   const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
   const body={fingerprint,count};const quote=await api('/api/export-quote',body);
   if(!dialog.open)return;
   localUrl=URL.createObjectURL(blob);
   summary.textContent=`${count} coaster${count===1?'':'s'} · Cost: ${quote.cost} test credit${quote.cost===1?'':'s'} · Balance: ${quote.balance} · After export: ${quote.remaining}`;
   if(quote.remaining<0){summary.textContent=`${count} coaster${count===1?'':'s'} · Cost: ${quote.cost} test credit${quote.cost===1?'':'s'} · Balance: ${quote.balance}`;message.textContent='Not enough test credits. No credits were used.';return;}
   message.textContent=quote.retry?'This exact file was already recorded. Preparing it again will not deduct credits.':'The file is ready. Credits are recorded only after you confirm below.';
   authorize.textContent=quote.retry?'Prepare free retry':`Confirm · ${quote.cost} test credit${quote.cost===1?'':'s'}`;
   authorize.disabled=false;
   authorize.addEventListener('click',async()=>{
    authorize.disabled=true;message.textContent='Recording export…';
    try{
     const debit=await api('/api/export-debit',body);
     summary.textContent=`${count} coaster${count===1?'':'s'} · Remaining balance: ${debit.remaining} test credits`;
     message.textContent=debit.retry?'This export is already recorded. No additional credits were used. Your file is ready.':`${debit.cost} test credit${debit.cost===1?'':'s'} recorded. Your file is ready to download.`;
     authorize.hidden=true;ready.hidden=false;ready.focus();
    }catch(error){message.textContent=error.message;authorize.disabled=false;}
   });
   // A fresh click preserves mobile browser download activation after the API request.
   ready.addEventListener('click',()=>save(localUrl,name));
  }catch(error){
   if(dialog?.open)dialog.querySelector('[data-message]').textContent=error.message;
   else document.getElementById('notice').textContent=error.message;
  }finally{if(!dialog?.open)preparing=false;}
 };
})();
