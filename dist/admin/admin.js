'use strict';
(()=>{
 const $=id=>document.getElementById(id),status=text=>{$('status').textContent=text;};
 let offset=0,search='',sort='name',direction='asc',limit=25,userGeneration=0,plan='all';
 async function api(path,body){
  const response=await fetch(path,{credentials:'same-origin',method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok){const error=Error(data.error || 'Request failed.');error.status=response.status;throw error;}return data;
 }
 function element(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
 async function busy(button,action){button.disabled=true;try{await action();}catch(error){status(error.message);}finally{button.disabled=false;}}
 function visitDate(value){return value?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(value):'Not recorded';}
 function planLabel(user){
  if(user.pro_complimentary_until>Date.now())return user.pro_until?'Pro + complimentary':'Complimentary Pro';
  return user.pro_until?'Pro':(user.pro_status||user.pro_complimentary_until)?'Pro inactive':'Standard';
 }
 function proGrantForm(user,mode){
  const form=element('form'),fields=element('fieldset'),expires=element('input'),reason=element('input');
  const heading=element('legend','Complimentary Pro'),current=element('p');
  const grant=element('button'),revoke=element('button','Revoke complimentary Pro');
  form.className='pro-grant-form';expires.type='datetime-local';reason.required=true;reason.minLength=3;reason.maxLength=300;
  grant.className=revoke.className='button secondary';
  const expirationLabel=element('label','Expiration (local time)'),reasonLabel=element('label','Reason');
  expirationLabel.append(expires);reasonLabel.append(reason);
  const buttons=element('div');buttons.className='admin-actions';buttons.append(grant,revoke);
  fields.append(heading,current,expirationLabel,reasonLabel,buttons);form.append(fields);
  let grantKey,revokeKey;
  function resetKeys(){grantKey=crypto.randomUUID();revokeKey=crypto.randomUUID();}
  resetKeys();
  function renderGrant(){
   const active=user.pro_complimentary_until>Date.now();
   current.textContent=active?'Access ends '+visitDate(user.pro_complimentary_until)+'.':'No active complimentary grant.';
   grant.textContent=active?'Update complimentary Pro':'Grant complimentary Pro';
   revoke.hidden=!active;
   const end=new Date(active?user.pro_complimentary_until:Date.now()+30*86400000);
   expires.value=new Date(end.getTime()-end.getTimezoneOffset()*60000).toISOString().slice(0,16);
  }
  renderGrant();
  fields.addEventListener('input',resetKeys);
  form.onsubmit=async event=>{
   event.preventDefault();
   const revoking=event.submitter===revoke;
   const end=revoking?null:new Date(expires.value).getTime();
   if(!revoking&&!Number.isFinite(end)){$('manage-status').textContent='Choose an expiration date.';return;}
   // Keep retries of the same action idempotent, including after a lost response.
   const key=revoking?revokeKey:grantKey;
   fields.disabled=true;
   try{
    const result=await api('/api/admin/pro-grant',{account:user.account,mode,expires:end,reason:reason.value,key});
    user.pro_complimentary_until=result.complimentaryUntil;resetKeys();reason.value='';renderGrant();
    $('manage-status').textContent=revoking?'Complimentary Pro revoked.':'Complimentary Pro saved.';
    await users();await audit();
   }catch(error){$('manage-status').textContent=error.message;}
   finally{fields.disabled=false;}
  };
  return form;
 }
 function manage(user,mode){
  const content=$('manage-content');content.replaceChildren();$('manage-status').textContent='';
  const heading=element('h2',user.name || 'Name not provided');heading.id='manage-title';content.append(heading,element('p',user.email),element('p','Joined: '+visitDate(user.joined_at)+' · Last visited: '+visitDate(user.last_visited_at)));
  const balance=element('p',user.credits+' credits');content.append(balance,element('p','Pro credits saved: '+user.pro_credits_saved.toLocaleString()));
  if(user.pro_until)content.append(element('p','Stripe Pro · Current period ends '+visitDate(user.pro_until)));
  const form=element('form'),delta=element('input'),reason=element('input'),button=element('button','Apply credit adjustment');form.className='credit-adjustment';
  delta.type='number';delta.step='1';delta.min='-100000';delta.max='100000';delta.required=true;reason.required=true;reason.minLength=3;reason.maxLength=300;button.className='button secondary';
  const creditLabel=element('label','Credits to add or remove'),reasonLabel=element('label','Reason');creditLabel.append(delta);reasonLabel.append(reason);form.append(creditLabel,reasonLabel,button);let key=crypto.randomUUID();
  form.addEventListener('submit',event=>{event.preventDefault();void busy(button,async()=>{try{const result=await api('/api/admin/credits',{account:user.account,delta:Number(delta.value),reason:reason.value,key});key=crypto.randomUUID();balance.textContent=result.credits+' credits';const message=`Credit adjustment saved. ${user.email}: ${result.credits} credits.`;status(message);$('manage-status').textContent=message;form.reset();await users();await audit();}catch(error){$('manage-status').textContent=error.message;throw error;}});});
  for(const input of [delta,reason])input.addEventListener('input',()=>{key=crypto.randomUUID();});content.append(form,proGrantForm(user,mode));
  if(!user.admin){const suspend=element('button',user.suspended?'Restore user':'Suspend user');suspend.className='text-button';suspend.onclick=()=>void busy(suspend,async()=>{try{await api('/api/admin/suspend',{account:user.account,suspended:!user.suspended});user.suspended=!user.suspended;suspend.textContent=user.suspended?'Restore user':'Suspend user';$('manage-status').textContent=user.suspended?'User suspended and signed out.':'User restored.';await users();await audit();}catch(error){$('manage-status').textContent=error.message;throw error;}});content.append(suspend);}
  $('manage-user').showModal();
 }
 async function users(){
  const generation=++userGeneration;
  const data=await api('/api/admin/users?'+new URLSearchParams({search,offset,limit,sort,direction,plan}));if(generation!==userGeneration)return;
  if(offset>=data.total && offset>0){offset=Math.max(0,Math.floor((data.total-1)/limit)*limit);return users();}
  const list=$('user-list');list.replaceChildren();$('previous').disabled=offset===0;$('next').disabled=offset+limit>=data.total;
  $('page-info').textContent=data.total?`${offset+1}–${Math.min(offset+limit,data.total)} of ${data.total} users`:'No matching users';
  $('page-number').replaceChildren();for(let page=0;page<Math.max(1,Math.ceil(data.total/limit));page++){const option=element('option',String(page+1));option.value=String(page+1);option.selected=page===Math.floor(offset/limit);$('page-number').append(option);}
  for(const button of document.querySelectorAll('[data-sort]')){const active=button.dataset.sort===sort;button.parentElement.setAttribute('aria-sort',active?(direction==='asc'?'ascending':'descending'):'none');}
  if(!data.users.length){const row=element('tr'),cell=element('td','No matching users.');cell.colSpan=8;row.append(cell);list.append(row);}
  for(const user of data.users){const row=element('tr');row.className='user';row.dataset.account=user.account;const identity=element('td');identity.append(element('strong',user.name || 'Not provided'),element('small',user.email));row.append(identity);
   for(const date of [user.joined_at,user.last_visited_at]){const cell=element('td');if(date){const time=element('time',visitDate(date));time.dateTime=new Date(date).toISOString();cell.append(time);}else cell.textContent='Not recorded';row.append(cell);}
   const credits=element('td',String(user.credits));credits.className='user-credits';const planCell=element('td',planLabel(user));if(user.pro_until||user.pro_complimentary_until>Date.now())planCell.className='active-pro';
   row.append(credits,planCell,element('td',user.pro_credits_saved.toLocaleString()),element('td',user.suspended?'Suspended':user.admin?'Admin':user.verified_at?'Verified':'Unverified'));const actions=element('td'),button=element('button','Manage');button.className='button secondary';button.setAttribute('aria-label','Manage '+(user.name || user.email));button.onclick=()=>manage(user,data.mode);actions.append(button);row.append(actions);list.append(row);
  }
 }
 const projectSearch=$('project-search'),projectPreview=$('admin-project-preview');
 const projectMakerNames={coaster:'Coaster',plaque:'Plaque','cookie-cutter':'Cookie Cutter'};
 let projectOffset=0,projectRequest=0,projectFilters={search:'',maker:''};
 function projectImage(url,alt){
  const image=element('img');image.alt=alt;image.decoding='async';image.src=url;
  image.onerror=()=>image.replaceWith(element('p','Artwork preview unavailable.'));
  return image;
 }
 function showProject(project){
  const choice=$('admin-project-image'),artwork=$('admin-project-artwork');
  $('admin-project-title').textContent=project.name;
  $('admin-project-owner').textContent=[project.owner,project.email,projectMakerNames[project.maker]].filter(Boolean).join(' · ');
  choice.replaceChildren(...Array.from({length:project.imageCount},(_,index)=>new Option('Image '+(index+1),index)));
  $('admin-project-image-choice').hidden=project.imageCount<2;
  choice.onchange=()=>artwork.replaceChildren(projectImage('/api/admin/projects/'+project.id+'/artwork/'+choice.value,project.name+' artwork'));
  if(project.imageCount)choice.onchange();
  else artwork.replaceChildren(element('p','No saved artwork.'));
  projectPreview.showModal();
 }
 projectPreview.addEventListener('close',()=>$('admin-project-artwork').replaceChildren());
 async function savedProjects(){
  const generation=++projectRequest;
  const result=$('project-results'),previous=$('project-prev'),next=$('project-next');
  result.textContent='Loading saved projects…';previous.disabled=next.disabled=true;
  try{
   const data=await api('/api/admin/projects?'+new URLSearchParams({...projectFilters,offset:projectOffset}));
   if(generation!==projectRequest)return;
   if(projectOffset>=data.total&&projectOffset){projectOffset=Math.max(0,Math.floor((data.total-1)/data.limit)*data.limit);return savedProjects();}
   result.textContent=data.total?`${projectOffset+1}–${projectOffset+data.projects.length} of ${data.total} projects`:'No matching projects.';
   previous.disabled=projectOffset===0;next.disabled=projectOffset+data.limit>=data.total;
   previous.onclick=()=>{projectOffset-=data.limit;void savedProjects();};
   next.onclick=()=>{projectOffset+=data.limit;void savedProjects();};
   $('project-list').replaceChildren(...data.projects.map(project=>{
    const card=element('li'),preview=element('div'),button=element('button','View project');
    preview.className='pro-project-preview';
    const image=projectImage('/api/admin/projects/'+project.id+'/thumbnail','');
    image.loading='lazy';preview.append(image);
    button.type='button';button.className='button secondary';
    button.setAttribute('aria-label','View project '+project.name);button.onclick=()=>showProject(project);
    card.append(preview,element('strong',project.name),element('span',project.owner?project.owner+' · '+project.email:project.email),
      element('small',projectMakerNames[project.maker]+' · Updated '+visitDate(project.updated)),button);
    return card;
   }));
  }catch(error){if(generation===projectRequest){$('project-list').replaceChildren();result.textContent=error.message;}}
 }
 projectSearch.onsubmit=event=>{
  event.preventDefault();projectOffset=0;projectFilters=Object.fromEntries(new FormData(projectSearch));void savedProjects();
 };
 function section(name){if(name==='projects')void savedProjects();if(name==='users')void users().catch(error=>status(error.message));if(name==='artwork')void artworkStatus();if(name==='resources')void resourcesStatus();for(const tab of document.querySelectorAll('[data-section]')){const active=tab.dataset.section===name;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;$(tab.dataset.section).hidden=!active;}}
 for(const tab of document.querySelectorAll('[data-section]')){tab.onclick=()=>section(tab.dataset.section);tab.addEventListener('keydown',event=>{const tabs=[...document.querySelectorAll('[data-section]')],index=tabs.indexOf(tab);let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;if(event.key==='Home')next=0;if(event.key==='End')next=tabs.length-1;if(next!==undefined){event.preventDefault();section(tabs[next].dataset.section);tabs[next].focus();}});}
 for(const button of document.querySelectorAll('[data-sort]'))button.onclick=()=>{direction=sort===button.dataset.sort&&direction==='asc'?'desc':'asc';sort=button.dataset.sort;offset=0;void users().catch(error=>status(error.message));};
 $('plan-filter').onchange=()=>{plan=$('plan-filter').value;offset=0;void users().catch(error=>status(error.message));};
 $('page-size').onchange=()=>{limit=Number($('page-size').value);offset=0;void users().catch(error=>status(error.message));};$('page-number').onchange=()=>{offset=(Number($('page-number').value)-1)*limit;void users().catch(error=>status(error.message));};
 function indexingStatus(name){
 let timer, version=0;
 return async function check(reindex=false){
  clearTimeout(timer);
  const request=++version;
  const button=$('reindex-'+name),message=$(name+'-status'),bar=$(name+'-progress');
  button.disabled=true;
  try{
   if(reindex)await api('/api/admin/'+name+'/reindex',{});
   const data=await api('/api/admin/'+name);
   if(request!==version)return;
   const progress=data.progress;
   bar.hidden=!data.running;
   if(data.running){
    if(progress?.total>0){
     bar.max=progress.total;
     bar.value=progress.processed;
    }else bar.removeAttribute('value');
    const progressMessage=[
     !progress||progress.total===null?'Finding artwork files…':
      progress.total===0?'Saving the empty artwork index…':
      progress.phase==='validating'?`Validating ${progress.processed} of ${progress.total} files.`:
       progress.phase==='tagging'?`Indexed ${progress.processed} of ${progress.total} valid PNGs.`:
       `Processed ${progress.processed} of ${progress.total} artwork files.`,
     progress?.converted?progress.converted+' WebP files converted.':'',
     progress?.failed?progress.failed+' tag requests failed.':'',
     progress?.skipped?progress.skipped+' files skipped.':''
    ].filter(Boolean).join(' ');
    if(message.textContent!==progressMessage)message.textContent=progressMessage;
    timer=setTimeout(check,2000);
    return;
   }
   message.textContent=[
    data.updatedAt?'Last indexed '+visitDate(new Date(data.updatedAt))+'.':'No index has been built.',
    data.indexed+' designs, '+data.tagged+' with tags.',
    data.converted?data.converted+' WebP files converted to PNG.':'',
    data.failed?data.failed+' tag requests failed. Reindex to retry.':'',
    data.skipped?data.skipped+' unreadable or invalid images skipped.':'',
    data.keyConfigured?'':'Configure OPENAI_API_KEY on the server to enable indexing.',
    data.error
   ].filter(Boolean).join(' ');
   if(data.skippedFiles?.length)message.textContent+=' Check '+data.skippedFiles.join(', ')+'.';
   button.disabled=!data.keyConfigured;
  }catch(error){
   if(request!==version)return;
   message.textContent=error.message;
   if(error.status===409||(!bar.hidden&&(!error.status||error.status>=500)))timer=setTimeout(check,2000);
   else {bar.hidden=true;button.disabled=false;}
  }
 };
 }
 const artworkStatus=indexingStatus('artwork'), resourcesStatus=indexingStatus('resources');
 $('reindex-resources').onclick=()=>void resourcesStatus(true);
 $('reindex-artwork').onclick=()=>void artworkStatus(true);
 async function settings(){const data=await api('/api/admin/settings'),form=$('settings');$('welcome-settings').elements.welcomeCredits.value=data.welcomeCredits;form.elements.billingEnabled.checked=data.billingEnabled;form.elements.paymentMode.value=data.paymentMode;form.elements.paymentMode.querySelector('[value=live]').disabled=!data.livePaymentsAllowed;form.elements.livePaymentsEnabled.checked=data.livePaymentsEnabled;form.elements.livePaymentsEnabled.disabled=!data.livePaymentsAllowed&&!data.livePaymentsEnabled;for(const key of ['liveSecretKey','liveWebhookSecret']){form.elements[key].value='';form.elements[key].disabled=!data.livePaymentsAllowed;}$('live-lock').textContent=data.livePaymentsAllowed?'Production is permitted to use live payments. Sandbox purchases remain restricted to development. Keep live payments off until setup is complete.':'Live payments are locked on this environment. Development remains in sandbox mode.';$('live-connection').textContent=`Live secret key: ${data.liveSecretKeyConfigured?'configured':'not configured'} · Live webhook: ${data.liveWebhookSecretConfigured?'configured':'not configured'}`;$('live-webhook-url').textContent=location.origin+'/api/webhooks/stripe/live';form.elements.price.value=(data.amount/100).toFixed(2);form.elements.credits.value=data.credits;for(const pack of data.packs.filter(pack=>pack.id!=='starter')){form.elements[pack.id+'Price'].value=(pack.amount/100).toFixed(2);form.elements[pack.id+'Credits'].value=pack.credits;}form.elements.secretKey.value='';form.elements.webhookSecret.value='';$('connection').textContent=`Test secret key: ${data.secretKeyConfigured?'configured':'not configured'} · Webhook secret: ${data.webhookSecretConfigured?'configured':'not configured'}`;$('webhook-url').textContent=location.origin+'/api/webhooks/stripe';}
 async function audit(){const data=await api('/api/admin/audit');$('audit-list').replaceChildren();for(const row of data.entries){const detail=JSON.parse(row.detail);let description=row.action;if(row.action==='credits')description=`${detail.delta>0?'+':''}${detail.delta} credits · ${detail.reason}`;if(row.action==='pro_grant')description='Complimentary Pro through '+visitDate(detail.expires)+' ('+detail.mode+') · '+detail.reason;if(row.action==='pro_revoke')description='Complimentary Pro revoked ('+detail.mode+') · '+detail.reason;if(row.action==='suspension')description=detail.suspended?'User suspended':'User restored';if(row.action==='settings'){const names={paymentMode:'payment mode',livePaymentsEnabled:'live payments switch',liveSecretKey:'live Stripe key',liveWebhookSecret:'live webhook secret',welcomeCredits:'new user credits',billingEnabled:'billing switch',amount:'pack price',credits:'pack credits',currency:'currency',additionalPacks:'additional credit packs',secretKey:'Stripe key',webhookSecret:'webhook secret'};description='Updated '+detail.changed.map(key=>names[key] || key).join(', ');}$('audit-list').append(element('li',`${new Date(row.created_at).toLocaleString()} · ${row.actorEmail}${row.targetEmail?' · '+row.targetEmail:''} · ${description}`));}}
 async function load(){try{const account=await api('/api/account');if(!account.admin){$('login').hidden=true;$('panel').hidden=true;status('This account does not have administrator access. Sign out from My account to use a different account.');return;}$('login').hidden=true;$('panel').hidden=false;await Promise.all([users(),settings(),audit()]);status('');}catch(error){$('panel').hidden=true;$('login').hidden=error.status!==401;status(error.status===401?'Sign in with your administrator account.':error.message);}}
 $('login').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;void busy(form.querySelector('button'),async()=>{try{await api('/api/login',{email:form.elements.email.value,password:form.elements.password.value});await load();}finally{form.elements.password.value='';}});});
 $('logout').addEventListener('click',()=>void busy($('logout'),async()=>{await api('/api/logout',{});await load();}));
 $('search').addEventListener('submit',event=>{event.preventDefault();search=event.currentTarget.elements.search.value;offset=0;void users().catch(error=>status(error.message));});
 $('previous').onclick=()=>{offset=Math.max(0,offset-limit);void users().catch(error=>status(error.message));};$('next').onclick=()=>{offset+=limit;void users().catch(error=>status(error.message));};
 $('refresh-audit').onclick=()=>void audit().catch(error=>status(error.message));
 $('welcome-settings').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;void busy(form.querySelector('button'),async()=>{await api('/api/admin/settings',{welcomeCredits:Number(form.elements.welcomeCredits.value)});status('New user credits saved. Existing balances are unchanged.');await audit();});});
 $('settings').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;void busy(form.querySelector('button'),async()=>{const body={paymentMode:form.elements.paymentMode.value,livePaymentsEnabled:form.elements.livePaymentsEnabled.checked,billingEnabled:form.elements.billingEnabled.checked,amount:Math.round(Number(form.elements.price.value)*100),credits:Number(form.elements.credits.value),currency:'usd',additionalPacks:['standard','large'].map(id=>({id,amount:Math.round(Number(form.elements[id+'Price'].value)*100),credits:Number(form.elements[id+'Credits'].value)}))};for(const key of ['secretKey','webhookSecret','liveSecretKey','liveWebhookSecret'])if(form.elements[key].value.trim())body[key]=form.elements[key].value.trim();await api('/api/admin/settings',body);for(const key of ['secretKey','webhookSecret','liveSecretKey','liveWebhookSecret'])form.elements[key].value='';status('Billing settings saved.');await settings();await audit();});});
 void load();
})();
