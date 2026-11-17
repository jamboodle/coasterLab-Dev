'use strict';
(()=>{
 const $=id=>document.getElementById(id),status=text=>{$('status').textContent=text;};
 let offset=0,search='';
 async function api(path,body){
  const response=await fetch(path,{credentials:'same-origin',method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok){const error=Error(data.error || 'Request failed.');error.status=response.status;throw error;}return data;
 }
 function element(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
 async function busy(button,action){button.disabled=true;try{await action();}catch(error){status(error.message);}finally{button.disabled=false;}}
 async function users(){
  const data=await api('/api/admin/users?search='+encodeURIComponent(search)+'&offset='+offset),list=$('user-list');list.replaceChildren();
  $('previous').disabled=offset===0;$('next').disabled=data.users.length<50;
  if(!data.users.length)list.append(element('p','No matching users.'));
  for(const user of data.users){
   const card=element('article');card.className='user';card.append(element('h3',user.email),element('p',`${user.credits} credits · ${user.verified_at?'Verified':'Unverified'}${user.admin?' · Admin':''}${user.suspended?' · Suspended':''}`));
   const form=element('form'),delta=element('input'),reason=element('input'),button=element('button','Apply credit adjustment');
   delta.type='number';delta.step='1';delta.min='-100000';delta.max='100000';delta.required=true;reason.required=true;reason.minLength=3;reason.maxLength=300;button.className='button secondary';
   const creditLabel=element('label','Credits to add or remove'),reasonLabel=element('label','Reason');creditLabel.append(delta);reasonLabel.append(reason);form.append(creditLabel,reasonLabel,button);let key=crypto.randomUUID();
   form.addEventListener('submit',event=>{event.preventDefault();void busy(button,async()=>{
    const result=await api('/api/admin/credits',{account:user.account,delta:Number(delta.value),reason:reason.value,key});key=crypto.randomUUID();status(`Credit adjustment saved. ${user.email}: ${result.credits} credits.`);await users();await audit();
   });});
   for(const input of [delta,reason])input.addEventListener('input',()=>{key=crypto.randomUUID();});card.append(form);
   if(!user.admin){const suspend=element('button',user.suspended?'Restore user':'Suspend user');suspend.className='text-button';suspend.addEventListener('click',()=>void busy(suspend,async()=>{await api('/api/admin/suspend',{account:user.account,suspended:!user.suspended});status(user.suspended?'User restored.':'User suspended and signed out.');await users();await audit();}));card.append(suspend);}
   list.append(card);
  }
 }
 async function settings(){const data=await api('/api/admin/settings'),form=$('settings');form.elements.billingEnabled.checked=data.billingEnabled;form.elements.price.value=(data.amount/100).toFixed(2);form.elements.credits.value=data.credits;form.elements.secretKey.value='';form.elements.webhookSecret.value='';$('connection').textContent=`Test secret key: ${data.secretKeyConfigured?'configured':'not configured'} · Webhook secret: ${data.webhookSecretConfigured?'configured':'not configured'}`;$('webhook-url').textContent=location.origin+'/api/webhooks/stripe';}
 async function audit(){const data=await api('/api/admin/audit');$('audit-list').replaceChildren();for(const row of data.entries){const detail=JSON.parse(row.detail);let description=row.action;if(row.action==='credits')description=`${detail.delta>0?'+':''}${detail.delta} credits · ${detail.reason}`;if(row.action==='suspension')description=detail.suspended?'User suspended':'User restored';if(row.action==='settings'){const names={billingEnabled:'billing switch',amount:'pack price',credits:'pack credits',currency:'currency',secretKey:'Stripe key',webhookSecret:'webhook secret'};description='Updated '+detail.changed.map(key=>names[key] || key).join(', ');}$('audit-list').append(element('li',`${new Date(row.created_at).toLocaleString()} · ${row.actorEmail}${row.targetEmail?' · '+row.targetEmail:''} · ${description}`));}}
 async function load(){try{const account=await api('/api/account');if(!account.admin){$('login').hidden=true;$('panel').hidden=true;status('This account does not have administrator access. Sign out from My account to use a different account.');return;}$('login').hidden=true;$('panel').hidden=false;await Promise.all([users(),settings(),audit()]);status('');}catch(error){$('panel').hidden=true;$('login').hidden=error.status!==401;status(error.status===401?'Sign in with your administrator account.':error.message);}}
 $('login').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;void busy(form.querySelector('button'),async()=>{try{await api('/api/login',{email:form.elements.email.value,password:form.elements.password.value});await load();}finally{form.elements.password.value='';}});});
 $('logout').addEventListener('click',()=>void busy($('logout'),async()=>{await api('/api/logout',{});await load();}));
 $('search').addEventListener('submit',event=>{event.preventDefault();search=event.currentTarget.elements.search.value;offset=0;void users().catch(error=>status(error.message));});
 $('previous').onclick=()=>{offset=Math.max(0,offset-50);void users().catch(error=>status(error.message));};$('next').onclick=()=>{offset+=50;void users().catch(error=>status(error.message));};
 $('refresh-audit').onclick=()=>void audit().catch(error=>status(error.message));
 $('settings').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;void busy(form.querySelector('button'),async()=>{const body={billingEnabled:form.elements.billingEnabled.checked,amount:Math.round(Number(form.elements.price.value)*100),credits:Number(form.elements.credits.value),currency:'usd'};for(const key of ['secretKey','webhookSecret'])if(form.elements[key].value.trim())body[key]=form.elements[key].value.trim();await api('/api/admin/settings',body);form.elements.secretKey.value='';form.elements.webhookSecret.value='';status('Billing settings saved.');await settings();await audit();});});
 void load();
})();
