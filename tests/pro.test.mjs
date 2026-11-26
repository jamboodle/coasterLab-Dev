import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {Ledger} from '../server/ledger.mjs';
import {handler} from '../server/app.mjs';
import {modelPayload} from './export-fixture.mjs';

test('Pro checkout, signed lifecycle events, zero-credit exports and private library', async () => {
  const ledger = new Ledger(':memory:');
  const account = ledger.registerIdentity('pro@example.com', 'salt', 'digest');
  const other = ledger.registerIdentity('other@example.com', 'salt', 'digest');
  ledger.makeAdmin('pro@example.com');
  const session = ledger.createSession(account);
  const otherSession = ledger.createSession(other);
  ledger.grantTestCredits(account, 4);
  ledger.saveSettings(account, {billingEnabled: true});
  const balance = ledger.balance(account);
  const price = {unit_amount: 1000, currency: 'usd', recurring: {interval: 'month', interval_count: 1}};
  const item = {quantity: 1, price, current_period_end: Math.floor(Date.now()/1000)+3600};
  const subscription = {id: 'sub_123', customer: 'cus_123', status: 'active', livemode: false,
    metadata: {coasterprint_plan: 'pro', coasterprint_account: account}, items: {data: [item]}};
  const webhookSecret = 'whsec_pro_test';
  let origin, checkouts = 0;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/checkout/sessions')) {
      checkouts++;
      assert.equal(options.body.get('mode'), 'subscription');
      assert.equal(options.body.get('line_items[0][price_data][unit_amount]'), '1000');
      assert.equal(options.body.get('line_items[0][price_data][recurring][interval]'), 'month');
      assert.equal(options.body.get('subscription_data[metadata][coasterprint_account]'), account);
      return Response.json({id: 'cs_test_123', livemode: false, url: 'https://checkout.stripe.com/example'});
    }
    if (url.endsWith('/checkout/sessions/cs_test_123')) {
      return Response.json({status:'complete',subscription:subscription.id});
    }
    if (url.endsWith('/billing_portal/sessions')) {
      assert.equal(options.body.get('customer'), 'cus_123');
      return Response.json({url: 'https://billing.stripe.com/example'});
    }
    assert.ok(url.endsWith('/subscriptions/sub_123'));
    return Response.json(subscription);
  };
  let app;
  const server = createServer((req,res) => app(req,res));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  app = handler({customerAccounts:true, ledger, origin, webhookSecret, secretKey:'sk_test_12345', fetchImpl});
  const call = (path, body, auth = session) => fetch(origin + path, {
    method: body ? 'POST' : 'GET', headers: {Origin: origin, Cookie: 'cl_session=' + auth}, body: body && JSON.stringify(body)
  });
  const event = (type, object = subscription, secret = webhookSecret) => {
    const body = JSON.stringify({id: 'evt_pro_test', type, livemode: false, data: {object}});
    const timestamp = Math.floor(Date.now()/1000);
    const hmac = createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
    return fetch(origin + '/api/webhooks/stripe',{method: 'POST', body, headers: {'Stripe-Signature': 't=' + timestamp + ',v1=' + hmac}});
  };
  const library = '/api/pro/library/plaque';
  try {
    assert.equal((await call('/api/pro')).status, 200);
    assert.equal((await call('/api/pro/checkout', {})).status, 200);
    assert.equal((await call('/api/pro/checkout', {})).status, 200);
    assert.equal(checkouts, 1);
    assert.equal((await call(library)).status, 403);
    assert.equal((await event('customer.subscription.created', subscription, 'wrong')).status, 400);
    assert.equal((await event('customer.subscription.created')).status, 200);
    assert.equal((await (await call('/api/maker-access')).json()).pro, true);
    assert.equal(ledger.isPro(account, 'live'), false);
    assert.equal((await call('/api/pro/checkout', {})).status, 409);
    ledger.saveSettings(account, {billingEnabled: false});
    assert.equal((await call('/api/pro/portal', {})).status, 200);
    ledger.saveSettings(account, {billingEnabled: true});

    const project = {kind: 'project', name: 'First plaque', payload: {version: 1,
      settings: {controls: {width: '125'}}, files: [{name:'art.png', data:'data:image/png;base64,YQ=='}]}};
    const created = await call(library, project);
    assert.equal(created.status, 201);
    const {id} = await created.json();
    assert.deepEqual((await (await call(library+'/'+id)).json()).payload, project.payload);
    ledger.savePro(other,'test','sub_other','cus_other','active',Date.now()+3600000);
    assert.deepEqual((await (await call(library, undefined, otherSession)).json()).items, []);
    assert.equal((await call(library+'/'+id, undefined, otherSession)).status, 404);
    assert.equal((await call(library, {...project, replace:id, name:'Updated plaque'})).status,201);
    assert.equal((await (await call(library+'/'+id)).json()).name,'Updated plaque');

    const quote = await (await call('/api/exports',modelPayload(2))).json();
    assert.equal(quote.cost,0);
    assert.equal((await call('/api/exports/'+quote.id+'/authorize',{expectedCost:0})).status,200);
    assert.equal((await call('/api/exports/'+quote.id+'/file')).status,200);
    assert.equal(ledger.balance(account),balance);
    ledger.pruneExports(Date.now()+86400001);
    const rebuilt = await (await call('/api/exports',modelPayload(2))).json();
    assert.notEqual(rebuilt.id,quote.id);
    assert.equal((await call('/api/exports/'+rebuilt.id+'/authorize',{expectedCost:0})).status,200);
    const list = await (await call('/api/admin/users?plan=pro&sort=creditsSaved&direction=desc')).json();
    assert.equal(list.total,2);
    assert.equal(list.users[0].account,account);
    assert.equal(list.users[0].pro_credits_saved,2);
    assert.ok(list.users[0].pro_until>Date.now());
    assert.equal((await call('/api/admin/users',undefined,otherSession)).status,403);
    assert.equal(ledger.users('pro@example.com',0,{mode:'live'})[0].pro_credits_saved,0);

    const next = await (await call('/api/exports',modelPayload(3))).json();
    subscription.status = 'past_due';
    await event('invoice.payment_failed', {parent:{subscription_details:{subscription:subscription.id}}});
    assert.equal((await call('/api/exports/'+next.id+'/authorize',{expectedCost:0})).status,409);
    assert.equal((await call(library)).status,403);
    assert.equal((await (await call('/api/exports/'+next.id)).json()).cost,3);

    subscription.status = 'active';
    item.current_period_end += 3600;
    await event('invoice.paid', {subscription:subscription.id});
    assert.equal((await (await call('/api/pro')).json()).active,true);
    subscription.status = 'canceled';
    await event('customer.subscription.deleted');
    assert.equal((await (await call('/api/pro')).json()).active,false);
    assert.equal(ledger.balance(account),balance);

    // A completed checkout whose webhook was missed must not start a second subscription.
    subscription.status = 'active';
    ledger.db.prepare('UPDATE pro_checkouts SET expires=0 WHERE account=?').run(account);
    assert.equal((await call('/api/pro/checkout', {})).status,409);
    assert.equal((await (await call('/api/pro')).json()).active,true);
    assert.equal(checkouts,1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    ledger.close();
  }
});

test('live Pro uses a taxable catalog price and explicitly requests Managed Payments', async () => {
  const {proBilling} = await import('../server/pro.mjs');
  const ledger = new Ledger(':memory:');
  try {
    const account = ledger.registerIdentity('live@example.com', 'salt', 'digest');
    const origin = 'https://coasterprint.com';
    const priceId = 'price_ProMonthly';
    const price = {id:priceId, active:true, livemode:true, unit_amount:1000, currency:'usd',
      recurring:{interval:'month', interval_count:1}, product:{active:true}};
    const keys = [];
    const params = {ledger, account, origin, mode:'live', enabled:true, secret:'sk_live_fixture',
      req:{method:'POST', headers:{origin}}, path:'/api/pro/checkout', send:(status, body)=>({status, body}),
      async fetchImpl(url, init) {
        if (url.includes('/prices/')) return Response.json(price);
        keys.push(init.headers['Idempotency-Key']);
        assert.equal(init.body.get('line_items[0][price]'), priceId);
        assert.equal(init.body.get('managed_payments[enabled]'), 'true');
        assert.equal(init.body.has('line_items[0][price_data][currency]'), false);
        return Response.json({livemode:true,id:'cs_live_123',url:'https://checkout.stripe.com/example'});
      }};
    assert.equal((await proBilling(params)).status, 503);
    assert.equal((await proBilling({...params, priceId})).status, 503);
    price.product.tax_code = 'txcd_10103000';
    price.unit_amount = 999;
    assert.equal((await proBilling({...params, priceId})).status, 503);
    price.unit_amount = 1000;
    assert.equal((await proBilling({...params, priceId})).status, 200);
    assert.notEqual(keys[0], ledger.pendingProCheckout(account, 'live').id);
    assert.equal((await proBilling({...params, priceId})).status, 200);
    assert.equal(keys.length, 1);
  } finally {
    ledger.close();
  }
});
