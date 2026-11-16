// An explicit local-only preview; no real email or payment credentials are required.
process.env.ENABLE_CUSTOMER_ACCOUNTS='1';
process.env.ENABLE_DEV_INBOX='1';
process.env.APP_ORIGIN ||= 'http://127.0.0.1:'+(process.env.PORT || '3003');
if(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_WEBHOOK_SECRET)throw Error('Use npm start for Stripe sandbox testing; npm run dev is a payment-free preview.');
await import('../server/index.mjs');
