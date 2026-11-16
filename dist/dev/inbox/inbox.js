'use strict';
async function refreshInbox(){
 const status=document.getElementById('inbox-status');
 try{
  const response=await fetch('/api/dev/inbox',{credentials:'same-origin',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('The local test inbox is not enabled here.');
  const {messages}=await response.json();const list=document.getElementById('messages');list.replaceChildren();
  for(const message of messages){
   const article=document.createElement('article'),heading=document.createElement('h2'),to=document.createElement('p'),link=document.createElement('a');
   heading.textContent=message.subject;to.textContent='To: '+message.to;
   const url=new URL(message.url);if(url.origin!==location.origin || url.pathname!=='/account/')continue;
   link.href=url.href;link.textContent='Open '+(url.hash.startsWith('#reset=')?'password reset':'email verification')+' link';
   article.append(heading,to,link);list.append(article);
  }
  status.textContent=messages.length?`${messages.length} local test message${messages.length===1?'':'s'}.`:'No messages yet. Register or request a password reset first.';
 }catch(error){status.textContent=error.message;}
}
document.getElementById('refresh-inbox').addEventListener('click',refreshInbox);refreshInbox();
