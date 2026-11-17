# Production Stripe payments

Live support is implemented but defaults **off**. No real payment was made during
automated verification; all Stripe calls in tests are mocked. The owner has already
verified the development sandbox's packs, cancellation, declines and duplicate
webhook delivery.

## Separation and activation

Development stays on its existing sandbox keys and test webhook:
`https://dev.jamboodle.com/api/webhooks/stripe`. Live configuration cannot be enabled
on the development origin. Production rejects sandbox checkouts and sandbox
webhooks, so test cards cannot mint production credits.

Live checkout requires all of:

- `NODE_ENV=production` and `ALLOW_LIVE_PAYMENTS=1` on the server.
- `APP_ORIGIN=https://coasterprint.com` (exact HTTPS origin).
- Development login and inbox disabled.
- A production live key (`sk_live_…`) and live webhook signing secret (`whsec_…`).
- Admin checkout mode set to **Live**, **Enable live payments** checked, and
  **Charge credits for 3MF exports** enabled.

The server permission alone does not turn on purchases. Code deployment alone
does not change keys, modes or switches. Blank secret inputs preserve saved values;
secret values are never returned or placed in the audit log.

## Rollout after development testing

1. Promote the tested release with `coasterprint-publish`. If not already applied,
   run the production private-export proxy helper described in SECURE-EXPORTS.md.
2. Register/sign in on production. Grant your production account admin access
   using the bootstrap command in ADMIN.md with `/home/jamboodle/coasterprint`.
   Development admin privileges, settings, users and credits are not copied.
3. Permit production to configure live payments. In the root terminal:

   ```sh
   install -d -m 0755 /etc/systemd/system/coasterprint-node.service.d
   cat > /etc/systemd/system/coasterprint-node.service.d/40-live-payments.conf <<'CONFIG'
   [Service]
   Environment=ALLOW_LIVE_PAYMENTS=1
   CONFIG
   systemctl daemon-reload
   systemctl restart coasterprint-node
   ```

   The existing production service already sets NODE_ENV and APP_ORIGIN. Keep
   live purchases disabled in admin while configuring credentials.
4. Use the existing Stripe account in **live mode**, not the sandbox. Complete
   Stripe's account activation if needed. Create a separate live webhook endpoint:
   `https://coasterprint.com/api/webhooks/stripe/live`, listening for
   `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
   Preserve existing projects' webhooks.
5. In production admin, leave **Enable live payments** off, enter the live key and
   signing secret in the separate **Stripe live connection** fields, and save.
   Never paste secrets into chat, source files, or shell history.
6. Review production pack prices, welcome-credit amount and customer-facing terms.
   Refunds/disputes currently require Stripe dashboard handling and manual admin
   balance adjustments; automatic refund/dispute reversal and tax handling are not
   implemented. No refund/expiry policy is invented by this change.
7. When ready to accept real charges, select Live mode, enable live payments and
   credit billing, and save. Production pricing now shows the real USD amount and
   a Buy credits button rather than sandbox labels. A real-card purchase is needed
   to verify the live account; sandbox card 4242… will not work in live mode.

## Payment integrity

Orders snapshot pack, amount, credits, currency and payment mode. Checkout retry
references are separated by mode. An old test page cannot silently start a live
checkout: a mode mismatch forces a fresh pricing page first. Stripe session mode
is checked before redirecting to checkout; live orders require an explicit live
session response. Return URLs never credit an account by themselves.

Each endpoint verifies its own signing secret. Event and session `livemode` values
must match that endpoint and the stored order mode. Correct amount/currency and a
paid status are required. Entries remain idempotent across repeated events and
concurrent deliveries. Unrelated Stripe projects' checkout events are acknowledged
without crediting; notifications that race our own session attachment get a retry.

Disabling new live purchases (or the server permission) does not discard genuine
pending-payment notifications. The production live endpoint continues authenticating
and fulfilling existing orders while its saved credentials remain configured.
Allow pending checkouts to settle before replacing a Stripe account/signing secret;
key rotation while live purchases are enabled is rejected. Overlapping old/new
signing secrets are not supported.

For an emergency pause, uncheck **Enable live payments**. Existing credits can
still be spent. Turning off **Charge credits for 3MF exports** also makes 3MF
exports free, so use that switch only when free exports are intended.
