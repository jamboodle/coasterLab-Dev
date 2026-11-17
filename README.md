# CoasterLab

Development repository: https://github.com/jamboodle/coasterLab-Dev (branch `main`).

Standalone development copy of the CoasterLab browser application, imported from
the owner-supplied r27 complete project ZIP, identified as Sites commit
`9c365be25cc14d218857750d743f1f40dbf2b69e`. The initial r25 import is retained
in local Git history. The inaccessible Sites commit has not been independently verified.
The original website checkout and its deployed copy are preserved.

## Try the current preview

Run `npm run dev` from the repository root with Node 24 or newer. This starts the
maker, account pages, pricing demo and local verification/recovery inbox on one
server. See [TESTING.md](TESTING.md) for the manual checklist. No real email is
sent and checkout is disabled in this mode.

## Develop

Use this existing checkout; no additional worktree is needed.
No application dependencies, build, credentials, or database are needed for the current app.

```sh
cd /workspace/coasterlab/dist
python3 -m http.server 3002 --bind 0.0.0.0
```

Open the root page through your development environment. Browser validation uses the
provided Node, Playwright and `/usr/bin/chromium`:

```sh
cd /workspace/coasterlab
SITE_URL=http://127.0.0.1:3002 node scripts/smoke.cjs
```

## Maker source and generated assets

Edit `src/maker/` for the maker JavaScript and run `npm run build`. The build
resolves script/worker dependencies, creates content-hashed assets, and updates
`dist/index.html`, the packing worker and asset manifest. `npm run build:check`
verifies that committed assets match source. Historical release pages/assets
and downloadable archives are retained; they are not rebuilt or deployed by
this command. The current maker remains based on r27. Existing vendor/font
licenses are retained.

`dist/export-packing.js` provides the worker bridge and touch-device default.
The current HTML includes a visible output selector: touch devices choose 3MF
only to avoid generating a merged STL and parts archive unnecessarily. The full
output mode is still selectable. Both modes preserve the 3MF geometry and colors.
3MF XML/ZIP packaging and the single-model STL-parts archive run in a worker;
this improves UI responsiveness without moving artwork to a server. The
existing three-minute geometry limit remains in place. Complex artwork can
still exceed a phone's memory or processing budget.

## Next development

See [ROADMAP.md](ROADMAP.md). The first selected priority is export credits and the
pricing flow. The opt-in backend now provides accounts, test checkout and credit accounting.
Real payment verification, real email delivery and paid export enforcement are pending. No production deployment is configured here.

## Pricing prototype

`dist/pricing/` contains a proposed $5 USD / 10-credit pricing page and an
in-memory credit simulator, linked from the current maker navigation. It is
explicitly a development preview: no purchase, authentication, persistent
balance, credit enforcement or real export is performed by the simulator.
Existing maker exports remain free. Historical release pages and downloadable
release archives are unchanged.

Run `node scripts/verify-pricing.cjs` with the documented server running to
check the flow at four viewport sizes. Styles and scripts for this standalone
page use direct references; no release asset regeneration is needed for it.

## Credit backend foundation

A Node 24 / SQLite test API now supports development account tokens, persistent
credit balances, server-priced Stripe test checkout, and signed idempotent
payment webhooks. Run `npm test` and `npm start`; see [server setup](server/README.md).
The pricing simulator remains separate. Customer sign-in is an opt-in preview;
live payments and paid export enforcement are disabled. CI runs the backend tests on pushes and PRs.

For integrated account/checkout testing, use `ENABLE_DEV_LOGIN=1 npm start` and
the same-origin server on port 3003. Its pricing page includes an opt-in
development account panel; the static-only server on port 3002 keeps that panel
hidden. Run `node scripts/verify-checkout.mjs` for a self-contained mocked-provider
browser test. Real Stripe sandbox verification is pending.

Customer registration and sign-in are available as an opt-in preview via
`ENABLE_CUSTOMER_ACCOUNTS=1 npm start`. The pricing page then uses email/password
accounts and the persistent credit balance. Run `node scripts/verify-accounts.mjs`
for the self-contained browser test. Real email delivery is pending;
this preview is not a public account launch.

Signed-in customer accounts can change their password and sign out every session.
The account panel also shows the latest 50 ledger entries. Password changes
require the current password and preserve the credit balance; real email delivery still requires configuration and validation.

Checkout requests reuse an account-scoped attempt after network errors or reloads.
The return page checks for webhook confirmation and refreshes confirmed credits.
Provider calls remain test-only and the automated checkout tests use a mock.

Verification and forgotten-password recovery now have single-use, expiring links
and a local test inbox. A real email provider is not configured. The automated
browser suite starts and stops its own isolated servers via `npm run test:browser`.

An optional 3MF credit-accounting trial now previews costs, records one debit per
exact file/account and supports free retries. It is disabled by default and is
not a production paywall. See TESTING.md before enabling it. Real money, secure
export fulfillment and refund rules remain outside this test flow.

## Server updates

Use the one-time setup in [DEPLOYMENT.md](DEPLOYMENT.md) to install
`coasterlab-update` on the Webuzo server. Future updates then use that command
instead of uploading ZIPs. It preserves runtime data and service configuration.
