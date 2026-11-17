'use strict';
(()=>{
 let preparing=false;
 const save=(url,name)=>{const link=document.createElement('a');link.href=url;link.download=name;link.click();};
 async function request(path,body){
  const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok){const error=Error(data.error || 'Credit service unavailable. Please retry.');error.status=response.status;throw error;}return data;
 }
 function panel(){
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-labelledby','export-credit-title');dialog.className='export-credit-dialog';
  dialog.innerHTML='<form method="dialog"><button class="dialog-close" aria-label="Close export confirmation">×</button></form><p class="eyebrow">3MF DOWNLOAD</p><h2 id="export-credit-title">Your download</h2><p><strong>Before printing:</strong> Coasters import design-side up so you can inspect the colors and details. For the best surface finish, flip each whole coaster design-side down onto the build plate before slicing. Keep the base and color parts together.</p><p data-summary></p><p data-message role="status" aria-live="polite"></p><div class="dialog-actions"><button data-authorize hidden>Confirm credits</button><button class="download-ready" data-save hidden>Download Ready</button></div><p data-account hidden><a href="/pricing/" target="_blank" rel="noopener">Log in</a> or <a href="/pricing/?register=1" target="_blank" rel="noopener">Create an account</a></p><button data-recheck hidden>I’m signed in · check again</button><p data-insufficient hidden>Change the download type to STL to download free, or <a href="/pricing/#export-pack" target="_blank" rel="noopener">purchase more credits</a>.</p><button data-stl hidden>Switch to free STL</button><details><summary>Credits & retries</summary><p>One credit per coaster when billing is on. STL is free. Retrying these exact file bytes does not deduct credits again. Keep this page open to retry.</p></details>';
  document.body.append(dialog);return dialog;
 }
 window.freeSTLDownload=async(selected)=>{
  const dialog=document.createElement('dialog');dialog.className='export-credit-dialog';dialog.setAttribute('aria-labelledby','free-stl-title');
  dialog.innerHTML='<form method="dialog"><button class="dialog-close" aria-label="Close STL download">×</button></form><p class="eyebrow">FREE DOWNLOAD · NO CREDITS</p><h2 id="free-stl-title">STL parts ZIP</h2><p><strong>3MF is recommended for the most reliable print results.</strong> It preserves color assignments and part alignment automatically. Free STL parts require manual setup; incorrect import or filament assignments can reduce print quality. Both formats use the same model geometry.</p><p data-progress role="status">Preparing your base and separate color parts…</p><button class="download-ready" data-free-save disabled>Preparing ZIP…</button><h3>Open in Bambu Studio</h3><ol><li>Extract the downloaded ZIP.</li><li>Select the base STL and all image-color STL files together.</li><li>Import as <strong>one object with multiple parts</strong>.</li><li>Assign a filament to each part.</li></ol><p>For a batch, repeat these steps for each coaster folder. Do not import parts individually or auto-arrange them.</p>';
  document.body.append(dialog);dialog.showModal();let file;
  dialog.addEventListener('close',()=>{if(file)URL.revokeObjectURL(file.url);dialog.remove();},{once:true});
  try{
   file=await window.prepareFreeSTL(selected);if(!dialog.open){URL.revokeObjectURL(file.url);return;}
   dialog.querySelector('[data-progress]').textContent='Your ZIP is ready. It includes the base, a separate STL for each color, and import instructions. No login or credits needed.';
   const button=dialog.querySelector('[data-free-save]');button.disabled=false;button.textContent='Download STL parts ZIP';button.onclick=()=>save(file.url,file.name);button.focus();
   const notice=document.getElementById('notice');if(notice)notice.textContent='Free STL parts ZIP is ready. Download it from the open dialog.';
  }catch(error){if(dialog.open){dialog.querySelector('[data-progress]').textContent=error.message;dialog.querySelector('[data-free-save]').textContent='ZIP unavailable';}}
 };
 window.creditTrialDownload=async(url,name,count)=>{
  if(preparing)return;preparing=true;
  let dialog,localUrl;
  try{
   const config=await request('/api/config');
   if(!config.exportLoginRequired && !config.exportCreditTrial){save(url,name);return;}
   dialog=panel();dialog.showModal();const signup=dialog.querySelector('[data-account] a[href*=register]');if(config.welcomeCredits>0)signup.textContent=`Create an account · ${config.welcomeCredits} free credits`;
   const summary=dialog.querySelector('[data-summary]'),message=dialog.querySelector('[data-message]'),authorize=dialog.querySelector('[data-authorize]'),ready=dialog.querySelector('[data-save]'),account=dialog.querySelector('[data-account]'),recheck=dialog.querySelector('[data-recheck]'),insufficient=dialog.querySelector('[data-insufficient]'),stl=dialog.querySelector('[data-stl]');
   dialog.addEventListener('close',()=>{if(localUrl)URL.revokeObjectURL(localUrl);dialog.remove();preparing=false;},{once:true});
   let body,readyBlob;
   // Retain batch bytes while the user signs in; the maker may revoke its temporary URL.
   const source=await fetch(url);if(!source.ok)throw Error('The ready file is no longer available. Rebuild it first.');readyBlob=await source.blob();if(!readyBlob.size)throw Error('The generated file is empty. No credits were used.');
   stl.onclick=()=>{dialog.close();void window.freeSTLDownload();};
   async function check(){
    authorize.hidden=true;ready.hidden=true;account.hidden=true;recheck.hidden=true;insufficient.hidden=true;stl.hidden=true;message.textContent='Checking your account and balance…';
    try{
     const user=await request('/api/account');
     if(!dialog.open)return;
     summary.textContent=`Your balance: ${user.credits} credits`;
     if(!body){body={fingerprint:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await readyBlob.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join(''),count};if(!dialog.open)return;localUrl=URL.createObjectURL(readyBlob);}
     const quote=await request('/api/export-quote',body);if(!dialog.open)return;
     summary.textContent=`${count} coaster${count===1?'':'s'} · Cost: ${quote.cost} credit${quote.cost===1?'':'s'} · Balance: ${quote.balance} · After export: ${quote.remaining}`;
     if(quote.remaining<0){message.textContent='Not enough credits. No credits were used.';insufficient.hidden=false;stl.hidden=false;return;}
     message.textContent=quote.cost===0?'No credits will be deducted for this download.':'Your file is ready. Credits are deducted only after you confirm.';
     authorize.textContent=quote.cost===0?'Prepare free download':`Confirm · ${quote.cost} credit${quote.cost===1?'':'s'}`;authorize.hidden=false;authorize.disabled=false;
    }catch(error){if(error.status===401){message.textContent='Log in or create an account to download 3MF. '+(config.welcomeCredits>0?`New accounts start with ${config.welcomeCredits} credits. `:'')+'STL downloads are free.';account.hidden=false;recheck.hidden=false;stl.hidden=false;}else message.textContent=error.message;}
   }
   recheck.onclick=()=>void check();
   authorize.onclick=async()=>{authorize.disabled=true;message.textContent='Preparing download…';try{const debit=await request('/api/export-debit',body);summary.textContent=`Remaining balance: ${debit.remaining} credits`;message.textContent=debit.retry?'No additional credits were used. Your file is ready.':`${debit.cost} credit${debit.cost===1?'':'s'} used. Your file is ready.`;authorize.hidden=true;ready.hidden=false;ready.focus();window.dispatchEvent(new Event('coasterprint-balance'));}catch(error){message.textContent=error.message;authorize.disabled=false;if(error.status===402){insufficient.hidden=false;stl.hidden=false;}if(error.status===401){authorize.hidden=true;account.hidden=false;recheck.hidden=false;}}};
   ready.onclick=()=>save(localUrl,name);
   await check();
  }catch(error){if(dialog?.open)dialog.querySelector('[data-message]').textContent=error.message;else{const notice=document.getElementById('notice');if(notice)notice.textContent=error.message;}}
  finally{if(!dialog?.open)preparing=false;}
 };
})();
