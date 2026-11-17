'use strict';
(()=>{
 const panel=document.getElementById('maker-account');
 async function refresh(){try{const response=await fetch('/api/account',{credentials:'same-origin',signal:AbortSignal.timeout(10000)});panel.replaceChildren();if(response.status===401){const link=document.createElement('a');link.href='/pricing/';link.textContent='Log in or create an account';try{const config=await (await fetch('/api/config',{credentials:'same-origin',signal:AbortSignal.timeout(10000)})).json();if(config.welcomeCredits>0)link.textContent+=` · ${config.welcomeCredits} free credits`;}catch{}panel.append(link);return;}if(!response.ok)return;const user=await response.json();panel.append(document.createTextNode(`${user.email || 'Signed in'} · ${user.credits} credits · `));const account=document.createElement('a');account.href='/pricing/';account.textContent='Manage account';panel.append(account);if(user.admin){const admin=document.createElement('a');admin.href='/admin/';admin.textContent=' · Admin';panel.append(admin);}}catch{}}
 window.addEventListener('focus',refresh);window.addEventListener('coasterprint-balance',refresh);void refresh();
})();
