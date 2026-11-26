import {createHash, randomUUID} from 'node:crypto';

export const proAmount = 1000;
const subscriptionId = /^sub_[a-zA-Z0-9]+$/;
const checkoutId = /^cs_(test|live)_[a-zA-Z0-9]+$/;
const customerId = /^cus_[a-zA-Z0-9]+$/;
const eventTypes = new Set(['customer.subscription.created', 'customer.subscription.updated',
  'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed', 'checkout.session.completed']);

async function stripe(fetchImpl, secret, path, form, key) {
  const response = await fetchImpl('https://api.stripe.com/v1/' + path, {
    method: form ? 'POST' : 'GET',
    headers: {Authorization: 'Bearer ' + secret, 'Stripe-Version': '2025-03-31.basil',
      ...(form && {'Content-Type': 'application/x-www-form-urlencoded'}),
      ...(key && {'Idempotency-Key': key})},
    body: form && new URLSearchParams(form), signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw Error('Stripe request failed');
  return response.json();
}

// Serialize up to the database write so an older response cannot overwrite a newer read.
const syncing = new Map();
export async function syncPro(ledger, event, mode, secret, fetchImpl) {
  if (!eventTypes.has(event.type) || event.livemode !== (mode === 'live')) return;
  const object = event.data?.object;
  if (!object) return;
  if (event.type === 'checkout.session.completed' &&
      (object.mode !== 'subscription' || object.metadata?.coasterprint_plan !== 'pro')) return;
  const id = event.type.startsWith('customer.subscription.') ? object.id :
    object.subscription || object.parent?.subscription_details?.subscription;
  if (!subscriptionId.test(id || '')) return;
  if (event.type.startsWith('customer.subscription.') && object.metadata?.coasterprint_plan !== 'pro') return;
  if (event.type.startsWith('invoice.') &&
      object.parent?.subscription_details?.metadata?.coasterprint_plan !== 'pro' &&
      object.subscription_details?.metadata?.coasterprint_plan !== 'pro' &&
      !ledger.db.prepare('SELECT 1 FROM pro_subscriptions WHERE id=? AND mode=?').get(id, mode)) return;
  return syncSubscription(ledger, mode, secret, fetchImpl, id);
}

async function syncSubscription(ledger, mode, secret, fetchImpl, id) {
  const key = mode + ':' + id;
  const next = (syncing.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    const sub = await stripe(fetchImpl, secret, 'subscriptions/' + id);
    const account = sub.metadata?.coasterprint_account;
    if (sub.metadata?.coasterprint_plan !== 'pro' || !/^[a-f0-9]{32}$/.test(account || '') ||
        !ledger.identityForAccount(account) || sub.livemode !== (mode === 'live') ||
        sub.id !== id || !customerId.test(sub.customer || '')) return;
    const items = sub.items?.data;
    const item = items?.[0];
    const price = item?.price;
    const valid = items?.length === 1 && item.quantity === 1 && price?.unit_amount === proAmount &&
      price.currency === 'usd' && price.recurring?.interval === 'month' && price.recurring.interval_count === 1;
    const end = item?.current_period_end ?? sub.current_period_end;
    ledger.savePro(account, mode, id, sub.customer, sub.status,
      valid && Number.isSafeInteger(end) && sub.status === 'active' ? end * 1000 : 0);
  });
  syncing.set(key, next);
  try { await next; } finally { if (syncing.get(key) === next) syncing.delete(key); }
}

export async function proBilling({req, path, send, ledger, account, mode, enabled, manageEnabled, secret, origin, fetchImpl, priceId}) {
  const managed = /^price_[A-Za-z0-9]+$/.test(priceId || '');
  const checkoutEnabled = enabled && (managed || (mode === 'test' && !priceId));
  const identity = ledger.identityForAccount(account);
  if (!identity) return send(403, {error: 'Sign in with a CoasterPrint email account.'});
  const subscription = ledger.proSubscription(account, mode);
  const complimentaryUntil = ledger.complimentaryProUntil(account, mode);
  const complimentary = complimentaryUntil > Date.now();
  if (req.method === 'GET' && path === '/api/pro') {
    return send(200, {active: ledger.isPro(account, mode), mode, status: subscription?.status ?? null,
      complimentaryUntil: complimentary ? complimentaryUntil : null,
      canManage: manageEnabled && Boolean(subscription), canSubscribe: checkoutEnabled && !subscription && !complimentary});
  }
  if (req.method !== 'POST' || !['/api/pro/checkout', '/api/pro/portal'].includes(path)) return send(404, {error: 'Not found'});
  if (req.headers.origin !== origin) return send(403, {error: 'Origin rejected'});
  const portalRequest = path.endsWith('/portal');
  if (!(portalRequest ? manageEnabled : checkoutEnabled)) return send(503, {error: 'Pro billing is unavailable.'});
  if (!ledger.allowAuth('pro-billing:' + account)) return send(429, {error: 'Too many requests. Try again later.'});
  try {
    if (portalRequest) {
      if (!subscription) return send(409, {error: 'No subscription to manage.'});
      const portal = await stripe(fetchImpl, secret, 'billing_portal/sessions',
        {customer: subscription.customer, return_url: origin + '/pricing/#pro'});
      if (!portal.url?.startsWith('https://billing.stripe.com/')) throw Error('Unexpected portal response');
      return send(200, {url: portal.url});
    }
    if (subscription) return send(409, {error: 'Manage your current subscription instead.'});
    if (complimentary) return send(409, {error: 'Complimentary Pro is already active on your account.'});
    const previous = ledger.pendingProCheckout(account, mode);
    if (previous?.session && previous.expires <= Date.now()) {
      const checkout = await stripe(fetchImpl, secret, 'checkout/sessions/' + previous.session);
      if (checkout.status === 'open') return send(409, {error: 'Your previous checkout is still open. Try again shortly.'});
      if (checkout.status === 'complete' && subscriptionId.test(checkout.subscription || '')) {
        await syncSubscription(ledger, mode, secret, fetchImpl, checkout.subscription);
        if (ledger.proSubscription(account, mode)) {
          return send(409, {error: 'Your previous checkout is already complete. Refresh to see your subscription.'});
        }
      }
    }
    const attempt = ledger.proCheckout(account, mode);
    // Reuse the same session on retries, even when there is under 30 minutes left.
    if (attempt.url) return send(200, {url: attempt.url});
    let lineItem = {
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(proAmount),
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][product_data][name]': 'CoasterPrint Pro'
    };
    let checkoutKey = attempt.id;
    if (managed) {
      const price = await stripe(fetchImpl, secret, 'prices/' + priceId + '?expand%5B%5D=product');
      if (price.id !== priceId || price.livemode !== (mode === 'live') || !price.active ||
          price.unit_amount !== proAmount || price.currency !== 'usd' ||
          price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1 ||
          price.product?.active !== true || !/^txcd_\d{8}$/.test(price.product.tax_code || '')) {
        return send(503, {error: 'The Stripe Pro product needs an active $10 USD monthly price and a product tax code.'});
      }
      lineItem = {'line_items[0][price]': priceId, 'managed_payments[enabled]': 'true'};
      // The catalog form differs from the original inline request.
      checkoutKey = createHash('sha256').update(attempt.id + ':managed:' + priceId).digest('hex');
    }
    const form = {mode: 'subscription', customer_email: identity.email, ...lineItem,
      'line_items[0][quantity]': '1', expires_at: String(attempt.expires / 1000),
      success_url: origin + '/pricing/?pro=returned#pro', cancel_url: origin + '/pricing/#pro',
      'subscription_data[metadata][coasterprint_plan]': 'pro',
      'subscription_data[metadata][coasterprint_account]': account,
      'metadata[coasterprint_plan]': 'pro', client_reference_id: account};
    const checkout = await stripe(fetchImpl, secret, 'checkout/sessions', form, checkoutKey);
    if (checkout.livemode !== (mode === 'live') || checkoutId.exec(checkout.id || '')?.[1] !== mode ||
        !checkout.url?.startsWith('https://checkout.stripe.com/')) throw Error('Unexpected checkout response');
    ledger.db.prepare('UPDATE pro_checkouts SET url=?,session=? WHERE id=?').run(checkout.url, checkout.id, attempt.id);
    return send(200, {url: checkout.url});
  } catch {
    return send(502, {error: 'Stripe is temporarily unavailable. Try again shortly.'});
  }
}

const maxSize = 26000000;
export async function proLibrary({req, res, path, send, ledger, account, mode, origin}) {
  if (!ledger.isPro(account, mode)) return send(403, {error: 'Active Pro access is required.'});
  const match = path.match(/^\/api\/pro\/library\/(coaster|plaque|cookie-cutter)(?:\/([a-f0-9-]{36})(\/thumbnail)?)?$/);
  if (!match) return send(404, {error: 'Not found'});
  const [, maker, id, thumbnailPath] = match;
  const db = ledger.db;
  if (req.method === 'GET') {
    if (thumbnailPath) {
      const saved = db.prepare(`SELECT COALESCE(thumbnail,json_extract(payload,'$.files[0].data')) AS image
        FROM pro_library WHERE account=? AND maker=? AND id=? AND kind='project'`).get(account,maker,id);
      const image = saved?.image?.match(/^data:image\/(png|jpeg);base64,([a-zA-Z0-9+/]+=*)$/);
      if (!image) return send(404,{error:'Project preview unavailable.'});
      res.writeHead(200,{'Content-Type':'image/'+image[1],'Cache-Control':'private, no-store',
        'X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
      return res.end(Buffer.from(image[2],'base64'));
    }
    if (!id) return send(200, {items: db.prepare('SELECT id,kind,name FROM pro_library WHERE account=? AND maker=? ORDER BY updated DESC').all(account, maker)});
    const row = db.prepare('SELECT id,kind,name,payload FROM pro_library WHERE account=? AND maker=? AND id=?').get(account, maker, id);
    return row ? send(200, {...row, payload: JSON.parse(row.payload)}) : send(404, {error: 'Saved item not found.'});
  }
  if (req.method !== 'POST' || thumbnailPath) return send(405, {error: 'Method not allowed'});
  if (req.headers.origin !== origin) return send(403, {error: 'Origin rejected'});
  if (id) {
    db.prepare('DELETE FROM pro_library WHERE account=? AND maker=? AND id=?').run(account, maker, id);
    return send(200, {ok: true});
  }
  if (!ledger.allowAuth('pro-library:' + account)) return send(429, {error: 'Too many saves. Try again later.'});
  const chunks = [];
  let size = 0;
  req.setTimeout(30000, () => req.destroy());
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxSize) return send(413, {error: 'Saved project is too large. Try smaller artwork.'});
    chunks.push(chunk);
  }
  req.setTimeout(0);
  let body;
  try { body = JSON.parse(Buffer.concat(chunks)); } catch {return send(400, {error: 'Invalid saved item.'});}
  const {kind, name, payload, replace, thumbnail} = body ?? {};
  if (!['preset', 'project'].includes(kind) || typeof name !== 'string' || !name.trim() || name.length > 80 ||
      !payload || payload.version !== 1 || !payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings) ||
      (thumbnail !== undefined && (kind !== 'project' || typeof thumbnail !== 'string' || thumbnail.length > 64000 ||
        !/^data:image\/jpeg;base64,[a-zA-Z0-9+/]+=*$/.test(thumbnail))) ||
      (kind === 'preset' && (size > 65536 || payload.files)) ||
      (kind === 'project' && (!Array.isArray(payload.files) || !payload.files.length || payload.files.length > (maker === 'coaster' ? 6 : 1) ||
        payload.files.some(file => typeof file?.name !== 'string' || !/\.(png|jpe?g)$/i.test(file.name) ||
          typeof file.data !== 'string' || !/^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/]+=*$/.test(file.data))))) {
    return send(400, {error: 'Use a valid project or preset and a name up to 80 characters.'});
  }
  const target = typeof replace === 'string' && db.prepare('SELECT length(CAST(payload AS BLOB))+coalesce(length(thumbnail),0) AS size FROM pro_library WHERE account=? AND maker=? AND kind=? AND id=?').get(account, maker, kind, replace);
  if (replace && !target) return send(404, {error: 'Saved item not found.'});
  const usage = db.prepare('SELECT count(*) AS count,coalesce(sum(length(CAST(payload AS BLOB))+coalesce(length(thumbnail),0)),0) AS size FROM pro_library WHERE account=?').get(account);
  if ((!target && usage.count >= 100) || usage.size - (target?.size || 0) + size > 100000000) {
    return send(409, {error: 'Your Pro library is full. Delete an item before saving.'});
  }
  const item = target ? replace : randomUUID();
  db.prepare('INSERT INTO pro_library(id,account,maker,kind,name,payload,updated,thumbnail) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload=excluded.payload,updated=excluded.updated,thumbnail=excluded.thumbnail')
    .run(item, account, maker, kind, name.trim(), JSON.stringify(payload), Date.now(), thumbnail ?? null);
  return send(201, {id: item});
}
