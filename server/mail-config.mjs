import {DevelopmentMailbox} from './mailbox.mjs';
import {SendmailMailer} from './sendmail.mjs';

export function configureMailer(environment,origin){
 const developmentInbox=environment.ENABLE_DEV_INBOX==='1';
 if(developmentInbox){
  if(!['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname))throw Error('Development inbox requires a loopback APP_ORIGIN');
  return {mailer:new DevelopmentMailbox(),developmentInbox:true};
 }
 const transport=environment.EMAIL_TRANSPORT || 'disabled';
 if(transport==='disabled')return {mailer:null,developmentInbox:false};
 if(transport!=='sendmail')throw Error('EMAIL_TRANSPORT must be disabled or sendmail');
 return {mailer:new SendmailMailer({from:environment.EMAIL_FROM,origin,path:environment.SENDMAIL_PATH || '/usr/sbin/sendmail'}),developmentInbox:false};
}
