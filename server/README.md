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
Real email delivery and development token management are not configured. Do not expose this API publicly yet.

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

Before public account launch: connect and validate real email delivery, account deletion, broader abuse controls, and hosted TLS/routing.
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
This password-change feature requires knowing the current password. The separate
forgotten-password recovery flow described below uses a mailbox link.

## Checkout retries and confirmation

The browser sends a random `Idempotency-Key` for each purchase attempt. Its key
is retained in sessionStorage across reloads and checkout failures; no password
or authentication token is stored there. Disconnect and confirmed purchases
clear it. Retrying uses the same account-scoped order and Stripe idempotency key,
including after a server restart. Concurrent retries cannot create extra orders.
Callers that omit the header still get a new attempt for backward compatibility;
API integrations must reuse a key to receive retry guarantees.

Orders now have additive request_key and created_at columns, migrated on startup
without deleting existing balances or purchase mappings. New Stripe sessions
expire one hour after attempt creation. Expired attempts and already-confirmed
attempts return 409 with checkout_expired or checkout_complete, respectively;
no new provider request is issued. The browser clears that key and asks the user
to refresh/retry rather than silently starting a second purchase.

GET /api/checkout-status?order=<reference> reports pending, confirmed, or expired
for an order owned by the authenticated account. Another account receives 404.
Checkout returns carry only the opaque order reference. The frontend checks for
confirmation with bounded sequential polling and then refreshes the ledger
balance. A browser redirect and query parameters never grant credits. A pending
state means no verified credit grant has been recorded; it is not proof that a
card was charged. A canceled return retains the attempt so it can be resumed.

## Verification, recovery and local inbox

`npm run dev` explicitly enables customer accounts and the loopback-only local
mailbox while rejecting Stripe credential configuration. It starts the same
server and persistent account DB; `npm start` retains explicit feature flags.
ENABLE_DEV_INBOX=1 supplies a temporary DevelopmentMailbox, not an SMTP service.
The local mailbox never sends mail over the network, logs links or persists raw
links; it keeps at most 50 messages for 24 hours in memory. Restart clears it.
The inbox API requires the explicit flag, a loopback socket and a loopback origin.
There is no hosted email provider adapter configured yet. The injectable mailer
interface is `send({to,subject,url})`; connecting it to real delivery is separate.

Registration attempts to send verification when a mailer is configured. Failed
delivery does not roll back a created account; sign in and resend instead. The
account response reports emailVerified and the panel can resend verification.
POST /api/send-verification requires an authenticated customer, exact Origin and
an account rate limit. POST /api/verify-email consumes a 24-hour verification
challenge. Links open a confirmation page and are not consumed by GET requests.

POST /api/recovery accepts email and returns the same public message for known
and unknown accounts (including provider failure). Email/IP throttles limit
requests. POST /api/reset-password accepts a 30-minute challenge and new password.
A successful reset atomically changes the password, invalidates every session and
bearer token, and consumes all outstanding account challenges. The user then
signs in again. Paid balances and account identity are preserved. Password
changes also invalidate outstanding recovery challenges. A concurrent reset
cannot reuse a challenge or overwrite a newer password.

Only SHA-256 challenge hashes are stored in SQLite, alongside a credential hash
version to reject stale resets. No raw recovery links are stored there. Link
tokens travel in URL fragments, not query strings, and are removed from the
address bar when read by the account page. Pages set no-referrer and API responses
use no-store. Both email routes and local mailbox are unavailable without their
explicit configuration. Real mailbox delivery and verification of deliverability
remain pending; verification logic alone does not launch public accounts.
