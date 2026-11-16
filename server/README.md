# Test credit API

Requires Node 24 (built-in SQLite); no third-party runtime packages are needed.
From the repository root, run `npm test`, then `npm start`. The API listens on
127.0.0.1:3003. `GET /health` reports readiness and whether test payments are
configured. The static app still runs separately on port 3002. No CORS access or
frontend checkout connection is enabled yet.

The persistent database defaults to `.data/credits.sqlite` (ignored by Git).
Use a durable volume and backups before hosted use. Set DATABASE_PATH to override.
The database includes sensitive account-token hashes and purchase mappings; keep
it outside any public document root. Do not serve the repository root as a website.

## Development accounts

`node server/index.mjs --create-account` provisions a development account and
returns its ID and bearer token once. Run it locally and keep the token private;
never paste tokens in issues, chat, URLs, or commit them. Only a hash is stored.
Tokens are a development integration mechanism, not customer sign-in. Public
signup, session management, revocation, recovery and identity verification remain
unimplemented. Do not expose this API publicly yet.

Authenticated requests use `Authorization: Bearer <development token>`:

- GET /api/balance returns `{ "credits": 0 }`.
- POST /api/checkout creates a server-priced Stripe test checkout for $5 USD and
  10 credits. It returns a checkout URL; it does not grant credits.
- POST /api/webhooks/stripe accepts raw signed Stripe events. Verified paid test
  sessions matching a locally created checkout add 10 credits once, even across
  repeated or differently named payment notifications. Unpaid/expired sessions,
  wrong amounts/currencies, and live payments do not add credits. Unknown paid
  sessions return an error so delivery can retry rather than silently lose credit.

## Payment configuration

Use secure environment settings for STRIPE_SECRET_KEY (test key only) and
STRIPE_WEBHOOK_SECRET. APP_ORIGIN is the exact static app origin, with no trailing
slash. The example file documents variable names; it is not auto-loaded. The
checkout adapter refuses live secret keys. The handler supports standard Stripe
webhook timestamp/signature verification with a five-minute tolerance.

Tests use a mocked Stripe endpoint and locally signed fixtures. No real Stripe
account, provider delivery, purchase, or external checkout was exercised. Test
with Stripe's sandbox and delivery tooling before connecting the frontend.

## Remaining work before payments or paid exports

Customer identity, secure hosted routing/TLS, rate limiting, operator account
controls, checkout retry UX, refunds/disputes, credit terms, actual export
fulfillment and usage enforcement are not implemented. The public client still
contains export functionality. This API neither gates nor charges existing
exports. No credit spend endpoint is provided until successful export fulfillment
can be authenticated; a browser callback is not proof that a paid export occurred.
