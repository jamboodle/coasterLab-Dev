# Test credit API

Requires Node 24 (built-in SQLite); no third-party runtime packages are needed.
From the repository root, run `npm test`, then `npm start`. The API listens on
127.0.0.1:3003. `GET /health` reports readiness and whether test payments are
configured. The same server serves only the `dist/` static directory, keeping API
and frontend on the same origin at http://127.0.0.1:3003. The separate Python
server remains useful for static-only work, but cannot serve the account API.
Set APP_ORIGIN to match the server's browser origin if you change the port.

The persistent database defaults to `.data/credits.sqlite` (ignored by Git).
Use a durable volume and backups before hosted use. Set DATABASE_PATH to override.
The database includes sensitive account-token hashes and purchase mappings; keep
it outside any public document root. Do not serve the repository root as a website.

## Development accounts

`node server/index.mjs --create-account` provisions a development account and
returns its ID and bearer token once. Run it locally and keep the token private;
never paste tokens in issues, chat, URLs, or commit them. Only a hash is stored.
Tokens are a development integration mechanism, not customer sign-in. To show
the pricing page's development account panel, start the app with
`ENABLE_DEV_LOGIN=1 npm start`. This opt-in is disabled by default. Enter the
provisioned account token in the panel; the server exchanges it for a one-day
HttpOnly, SameSite=Strict session cookie (Secure on HTTPS). Tokens are cleared
from the form and never saved to browser storage. Logout revokes that session
in SQLite, and login rotates an existing session. Customer sign-up is available separately as an opt-in preview below. Identity
verification, recovery, and development token revocation remain unimplemented. Do not expose this API publicly yet.

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
with Stripe's sandbox and delivery tooling before considering payments validated.

## Remaining work before payments or paid exports

Verified customer identity, secure hosted routing/TLS, broader abuse controls,
operator account controls, refunds/disputes, credit terms, actual export
fulfillment and usage enforcement are not implemented. The public client still
contains export functionality. This API neither gates nor charges existing
exports. No credit spend endpoint is provided until successful export fulfillment
can be authenticated; a browser callback is not proof that a paid export occurred.

## Frontend integration checks

Run `node scripts/verify-checkout.mjs` to launch an ephemeral same-origin server
with an in-memory database and a mocked payment provider. It exercises login,
cookies, server balances, failed-checkout retry, checkout redirect, canceled return,
webhook confirmation and logout with a real browser. It needs the same provided
Playwright/Chromium as the existing browser tests. No real secrets are required.

The development panel is shown only when `/api/config` explicitly enables it.
Checkout stays disabled without configured test keys. Returning from Stripe
never adds credits; the panel reads the server balance and provides a refresh
button for delayed webhook delivery. The existing credit simulator is independent.

## Customer account preview

Start `ENABLE_CUSTOMER_ACCOUNTS=1 npm start` to expose registration and sign-in
on the pricing page. It is disabled by default. No email service is required
for this preview, and email addresses are not verified. Passwords must contain
12–128 characters; salted scrypt hashes are stored in the existing SQLite DB.
Registration creates an empty credit account. Sign-in uses the existing one-day
HttpOnly session and rotates the current session; logout revokes it. The customer
flow does not expose or require development bearer tokens.

POST /api/register and POST /api/login accept JSON email/password fields. Email
is trimmed and lowercased. Both require the configured exact Origin, even when
an Authorization header is present. A persistent limit allows 20 attempts per
15 minutes per socket IP; only the IP hash is stored. Proxy headers are not
trusted. Hosted deployments must configure their trusted proxy and review the
limit for shared IPs. Password hashing is limited to four concurrent requests
per running API handler. No passwords or session values are logged.

`node scripts/verify-accounts.mjs` exercises registration, sign-in, invalid
passwords, session persistence and logout through a real browser on desktop
and mobile with an isolated in-memory DB. Backend tests cover normalization,
password hashes, duplicate registration, session rotation and throttling.

Before public account launch: implement email verification, password recovery, account deletion, broader abuse controls, and hosted TLS/routing.
Customer account support here does not enable live purchases or paid exports.

## Account controls and activity

GET /api/account returns the authenticated account's balance, email (when
registered), password-account flag, and latest 50 credit entries. It never
accepts an account ID from the browser, and never returns password hashes or
session identifiers. Legacy entries do not have dates; the UI does not invent
purchase timestamps.

POST /api/password accepts currentPassword and newPassword for customer
accounts. It requires the current password, a different 12–128-character new
password, exact Origin, and the authentication rate/concurrency limits. Password
updates are conditional on the previously verified hash so concurrent changes
cannot overwrite a newer password. The update invalidates all existing sessions
and bearer tokens, then issues a fresh session for the requesting browser.
Credits and purchase history are preserved. In-progress login checks also
recheck the current password hash before creating a session.

POST /api/logout-all invalidates all sessions and bearer tokens for a customer
account and clears this browser's cookie. It requires exact Origin. It is not
offered for development-token-only accounts because revoking their only login
method would make them inaccessible; these accounts retain Disconnect instead.
Password recovery is still unavailable, so this feature requires knowing the
current password and is not a forgotten-password reset.
