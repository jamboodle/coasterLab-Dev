export function stripeKeyMode(value){return typeof value==='string'?value.match(/^(?:sk|rk)_(test|live)_[A-Za-z0-9_]{4,240}$/)?.[1]:undefined;}
export function paymentContext({settings,secretKey,webhookSecret,origin,allowLivePayments=false,developmentLogin=false,developmentInbox=false}){
 const productionOrigin=origin==='https://coasterprint.com';
 const liveAllowed=allowLivePayments&&productionOrigin&&!developmentLogin&&!developmentInbox;
 const mode=settings.paymentMode==='live'?'live':'test';
 const credentials={test:{secret:settings.secretKey||secretKey,webhook:settings.webhookSecret||webhookSecret},live:{secret:settings.liveSecretKey,webhook:settings.liveWebhookSecret}};
 const configured=kind=>Boolean(stripeKeyMode(credentials[kind].secret)===kind&&credentials[kind].webhook);
 return {mode,liveAllowed,productionOrigin,testAllowed:!productionOrigin,credentials,configured,paymentsEnabled:Boolean(settings.billingEnabled&&configured(mode)&&(mode==='test'?!productionOrigin:(liveAllowed&&settings.livePaymentsEnabled)))};
}
