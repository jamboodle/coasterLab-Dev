# CoasterPrint

Public domain: **coasterprint.com**. See [BRANDING.md](BRANDING.md) for the one-time
updater refresh and the separate domain/mail configuration steps.

Development repository: https://github.com/jamboodle/coasterLab-Dev (branch `main`).

Standalone development copy of the CoasterPrint browser application, imported from
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

`src/maker/export-packing.js` provides the browser worker bridge. The maker builds the
base and individual color parts locally. Free STL ZIPs package those parts locally;
merged STL is no longer offered. For 3MF, a browser worker serializes the model
parts and printer settings, then the server validates and assembles a private
account-bound file. Original images stay local. See [SECURE-EXPORTS.md](SECURE-EXPORTS.md)
for upload disclosure, credit authorization, retention and deployment settings. The
existing three-minute geometry limit remains in place. Complex artwork can
still exceed a phone's memory or processing budget.

## Suncatcher Maker

Open `/suncatcher/` or choose **Suncatcher Maker** from the main navigation.
Try the flower sample or upload PNG, JPG, or SVG line art with closed outlines.
Set the finished size and clearance per side, then download the numbered STL
set or a separate-object 3MF for slicer import. Artwork, tracing, model
generation, and downloads run in the browser.

Print the fit coupon with the materials and first-layer settings you plan to use.
Print the frame with the front lip against the build plate, print the inserts
separately, and seat them from the back against the lip. The ZIP includes a
numbered assembly map. The lip prevents the inserts passing through the front.
Use a small amount of compatible adhesive if the inserts need rear retention.

The static page ships with the existing development and production release
packages. No additional service or proxy configuration is required.

## Plaque Maker

Open `/plaque/` from the main navigation. Choose or drop a PNG or JPG and trace it into
solid colors. Set each color’s top height above the bed and choose its print
color, then build the stacked relief. Drag the 3D preview to inspect the actual
export mesh. Drag the backing color to the bottom row, marked **Base**. It
fills the plaque outline, and each lower tier extends under the tiers above
it. The listed heights are measured from the print bed. Reordering colors
reassigns the existing heights.
Background colors are kept by default. Enable edge-background removal to discard
a plain exterior color. Advanced tracing uses the coaster maker’s controls.
Relief cleanup smooths narrow edges and removes small disconnected raised details.

The 3MF uses the existing Bambu P1S 0.4 mm project preset and assigns each
tier to its filament. The prime tower defaults to off because large plaques can
occupy its usual spot. The STL ZIP includes the same stacked geometry and a
height guide. Import all STL tiers together to preserve the vertical offsets.
Tracing, geometry, and free STL downloads run in the browser. A private 3MF
uses the same CoasterPrint account balance, at one credit when billing is on.
The server assembles the 3MF from model parts; the original artwork stays local.

## Next development

See [ROADMAP.md](ROADMAP.md). The first selected priority is export credits and the
pricing flow. The opt-in backend now provides accounts, test checkout and credit accounting.
Hosted verification/recovery emails and Stripe sandbox payments have been verified by the owner. Development and production deployments are separate. Production live activation is documented in [LIVE-PAYMENTS.md](LIVE-PAYMENTS.md).

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
live payments default off and hosted 3MF delivery is account-bound. CI runs the backend tests on pushes and PRs.

For integrated account/checkout testing, use `ENABLE_DEV_LOGIN=1 npm start` and
the same-origin server on port 3003. Its pricing page includes an opt-in
development account panel; the static-only server on port 3002 keeps that panel
hidden. Run `node scripts/verify-checkout.mjs` for a self-contained mocked-provider
browser test. The owner has verified the hosted Stripe sandbox flow.

Customer registration and sign-in are available as an opt-in preview via
`ENABLE_CUSTOMER_ACCOUNTS=1 npm start`. The pricing page then uses email/password
accounts and the persistent credit balance. Run `node scripts/verify-accounts.mjs`
for the self-contained browser test. Hosted email delivery has been verified;
this preview is not a public account launch.

Signed-in customer accounts can change their password and sign out every session.
The account panel also shows the latest 50 ledger entries. Password changes
require the current password and preserve the credit balance; hosted verification and recovery delivery have been verified.

Checkout requests reuse an account-scoped attempt after network errors or reloads.
The return page checks for webhook confirmation and refreshes confirmed credits.
Automated checkout tests use a mock. Production live calls require the separate permission, credentials and admin switch described in LIVE-PAYMENTS.md.

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

The maker follows a numbered upload → customize → build → download flow. Detailed
settings, diagnostics and secondary formats are available in expandable sections.
The final credit-confirmed action is a green **Download Ready** button.

Hosted verification and recovery can use Webuzo's local Exim/Sendmail-compatible
mail service. See [EMAIL.md](EMAIL.md) for setup and real-delivery checks. It is
disabled until configured; `npm run dev` still uses only the local test inbox.

The maker's repeated workflow/printing marketing sections have been removed.
Account & credits is now a compact account-first page: explicit sign-in/create
account modes, a clear balance, a small credit-pack summary and expandable
activity, security and demo information. Billing behavior is unchanged.

Administration and welcome credits: see [ADMIN.md](ADMIN.md) for first-admin setup, billing controls and the supported download flow.

Private 3MF generation/delivery and deployment upload settings: [SECURE-EXPORTS.md](SECURE-EXPORTS.md). Current 3MF packaging is server-side; historical client packaging descriptions apply to earlier releases.

Production account separation and the one-time move are documented in
[ACCOUNT-SEPARATION.md](ACCOUNT-SEPARATION.md). Routine releases are in
[PRODUCTION.md](PRODUCTION.md).
