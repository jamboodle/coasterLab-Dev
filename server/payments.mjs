export function paymentContext({settings,secretKey,webhookSecret,origin,allowLivePayments=false,developmentLogin=false,developmentInbox=false}){
 const productionOrigin=origin==='https://coasterprint.com';
 const liveAllowed=allowLivePayments&&productionOrigin&&!developmentLogin&&!developmentInbox;
 const mode=settings.paymentMode==='live'?'live':'test';
 const credentials={test:{secret:settings.secretKey||secretKey,webhook:settings.webhookSecret||webhookSecret},live:{secret:settings.liveSecretKey,webhook:settings.liveWebhookSecret}};
 const configured=kind=>Boolean(credentials[kind].secret?.startsWith(kind==='live'?'sk_live_':'sk_test_')&&credentials[kind].webhook);
 return {mode,liveAllowed,productionOrigin,testAllowed:!productionOrigin,credentials,configured,paymentsEnabled:Boolean(settings.billingEnabled&&configured(mode)&&(mode==='test'?!productionOrigin:(liveAllowed&&settings.livePaymentsEnabled)))};
}
