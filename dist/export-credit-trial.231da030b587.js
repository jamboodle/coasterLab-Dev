'use strict';
(()=>{
 let preparing=false;
 const save=(url,name)=>{const link=document.createElement('a');link.href=url;link.download=name;link.click();};
 async function request(path,body){
  const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?(typeof body==='string'?body:JSON.stringify(body)):undefined,signal:AbortSignal.timeout(path==='/api/exports'?90000:15000)});
  const data=await response.json();if(!response.ok){const error=Error(data.error || 'Credit service unavailable. Please retry.');error.status=response.status;throw error;}return data;
 }
 function panel(kind){
  const printNote=kind==='cookie cutter set'?'Print the pieces in their exported positions. Screw the ring handle into the back of the stamp after printing.':kind==='plaque'?'Keep all plaque tiers together, with the flat base on the build plate.':'For a smoother artwork surface, flip the entire coaster in your slicer so the artwork faces down against the build plate. Keep the base and color parts together.';
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-labelledby','export-credit-title');dialog.className='export-credit-dialog';
  dialog.innerHTML='<form method="dialog"><button class="dialog-close" aria-label="Close export confirmation">×</button></form><p class="eyebrow">3MF DOWNLOAD</p><h2 id="export-credit-title">Your download</h2><p><strong>Before printing:</strong> '+printNote+'</p><p data-summary></p><p data-message role="status" aria-live="polite"></p><div class="dialog-actions"><button data-authorize hidden>Confirm credits</button><button class="download-ready" data-save hidden>Download Ready</button></div><p data-account hidden><a href="/pricing/" target="_blank" rel="noopener">Log in</a> or <a href="/pricing/?register=1" target="_blank" rel="noopener">Create an account</a></p><button data-recheck hidden>I’m signed in · check again</button><p data-insufficient hidden>Change the download type to STL to download free, or <a href="/pricing/#export-pack" target="_blank" rel="noopener">purchase more credits</a>.</p><button data-stl hidden>Switch to free STL</button><details><summary>Credits & retries</summary><p>One credit per '+kind+' when billing is on. STL is free. Retrying these exact file bytes does not deduct credits again. Keep this page open to retry.</p></details>';
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
 window.creditTrialDownload=async(preparePayload,{kind='coaster',freeSTL=()=>window.freeSTLDownload(),onError}={})=>{
  if(preparing)return;preparing=true;let dialog;
  try{
   const config=await request('/api/config');dialog=panel(kind);dialog.showModal();const signup=dialog.querySelector('[data-account] a[href*=register]');if(config.welcomeCredits>0)signup.textContent=`Create an account · ${config.welcomeCredits} free credits`;
   const summary=dialog.querySelector('[data-summary]'),message=dialog.querySelector('[data-message]'),authorize=dialog.querySelector('[data-authorize]'),ready=dialog.querySelector('[data-save]'),account=dialog.querySelector('[data-account]'),recheck=dialog.querySelector('[data-recheck]'),insufficient=dialog.querySelector('[data-insufficient]'),stl=dialog.querySelector('[data-stl]');
   const privacy=document.createElement('p');privacy.textContent='Preparing 3MF uploads the generated model parts and printer settings to our server. Original images are only uploaded when you save a Pro project. Prepared downloads are private and kept for up to 24 hours.';privacy.className='hint';dialog.append(privacy);
   dialog.addEventListener('close',()=>{dialog.remove();preparing=false;},{once:true});let job,quote,downloadUrl;
   stl.onclick=()=>{dialog.close();void freeSTL();};
   async function check(){
    authorize.hidden=true;ready.hidden=true;account.hidden=true;recheck.hidden=true;insufficient.hidden=true;stl.hidden=true;message.textContent='Checking your account…';
    try{
     const profile=await request('/api/account');if(!dialog.open)return;
     if(!job){message.textContent='Preparing your private 3MF download… No credits are deducted yet.';if(typeof preparePayload!=='function')throw Error('Build your '+kind+' and use its 3MF download button.');const result=await request('/api/exports',await preparePayload());job=result.id;quote=result;}
     else quote=await request('/api/exports/'+job);
     if(!dialog.open)return;
     summary.textContent=`${profile.pro?'CoasterPrint Pro · ':''}${quote.count} ${kind}${quote.count===1?'':'s'} · Cost: ${quote.cost} credit${quote.cost===1?'':'s'} · Balance: ${quote.balance} · After export: ${quote.remaining}`;
     if(quote.remaining<0){message.textContent='Not enough credits. No credits were used.';insufficient.hidden=false;stl.hidden=false;return;}
     message.textContent=quote.cost===0?'No credits will be deducted for this download.':'Your file is ready. Credits are deducted only after you confirm.';authorize.textContent=quote.cost===0?'Prepare free download':`Confirm · ${quote.cost} credit${quote.cost===1?'':'s'}`;authorize.hidden=false;authorize.disabled=false;
    }catch(error){if(error.status===401){message.textContent='Log in or create an account to download 3MF. '+(config.welcomeCredits>0?`New accounts start with ${config.welcomeCredits} credits. `:'')+'STL downloads are free.';account.hidden=false;stl.hidden=false;recheck.textContent='I’m signed in · check again';}else{message.textContent=error.message;recheck.textContent='Try again';}recheck.hidden=false;}
   }
   recheck.onclick=()=>void check();
   authorize.onclick=async()=>{authorize.disabled=true;message.textContent='Authorizing your private download…';try{const debit=await request('/api/exports/'+job+'/authorize',{expectedCost:quote.cost});downloadUrl=debit.url;summary.textContent=`Remaining balance: ${debit.remaining} credits`;message.textContent=debit.retry?'No additional credits were used. Your file is ready.':`${debit.cost} credit${debit.cost===1?'':'s'} used. Your file is ready.`;authorize.hidden=true;ready.hidden=false;ready.focus();window.dispatchEvent(new Event('coasterprint-balance'));}catch(error){message.textContent=error.message;authorize.disabled=false;if(error.status===409)await check();if(error.status===402){insufficient.hidden=false;stl.hidden=false;}if(error.status===401){authorize.hidden=true;account.hidden=false;recheck.hidden=false;}}};
   ready.onclick=()=>save(downloadUrl,quote.format==='cookie'?'coasterprint-cookie-cutter-set.3mf':quote.format==='plaque'?'coasterprint-plaque.3mf':quote.format==='individual'?'coasterprint-individual-models.zip':'coasterprint-coaster.3mf');await check();
  }catch(error){if(dialog?.open)dialog.querySelector('[data-message]').textContent=error.message;else if(onError)onError(error);else{const notice=document.getElementById('notice');if(notice)notice.textContent=error.message;}}
  finally{if(!dialog?.open)preparing=false;}
 };
})();
