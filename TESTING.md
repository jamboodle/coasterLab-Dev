# Test the development app

Use Node 24 or newer in the `jamboodle/coasterLab-Dev` checkout. No package install,
payment credentials or email service is needed for the local preview.

```sh
npm run dev
```

The server listens on the local machine at port 3003. Open the pricing page at
`/pricing/` in that local server. Use `PORT=3005 npm run dev` if the default port
is occupied. The matching origin is selected automatically unless APP_ORIGIN is
already set. Run from the repository root. This is a local preview, not a public
hosted deployment; the website's production copy is separate.

## What to try

1. Open Pricing preview from the maker and try the demo credit pack and export
   simulator. These do not charge money or generate files.
2. Create an account with a test email and a password of 12–128 characters.
3. Open **local test inbox** from the pricing page. Open the verification message
   and select **Verify my email**. Return to pricing and refresh the account to
   see the verified email status.
4. Try sign-out/sign-in, password change, and **Sign out everywhere**. The old
   password must fail after a password change; credits must remain unchanged.
5. Sign out and choose **Forgot your password?**. Request a reset, open its link
   through the local test inbox and choose a new password. Sign in again. Reusing
   the same reset link must fail. Reset links expire after 30 minutes; verification
   links expire after 24 hours. Requesting another link replaces the previous link
   of the same type.
6. Try the maker's existing upload, trace and export features. These remain free
   and process artwork in the browser. Payment/credit controls do not enforce
   paid exports yet.

The test inbox sends no real email and is deliberately disabled in normal startup.
Its messages exist only in server memory and are cleared on restart. Account data,
password hashes, balances and token hashes persist under ignored `.data/`; do not
upload that directory, expose it through a web server, or commit it. Use test
accounts and passwords. No account deletion UI is available yet.

Real checkout is disabled in `npm run dev`. Use the separate sandbox setup in
[server/README.md](server/README.md) when Stripe credentials are available. The
hosted email provider, Stripe sandbox delivery, live billing and paid export
fulfillment still need integration and validation.

## Automated checks

```sh
npm test
npm run test:browser
```

Backend tests require only Node 24. Browser tests additionally require Playwright
and Chromium (provided in the prepared cloud environment). The browser runner now
starts isolated test servers itself; no manually started Python server or API is
required. Its databases, account fixtures, payment provider and mailbox are
isolated, so automated checks do not create real accounts, purchases or email.

The suite also uploads a generated test image, runs the tracing and WebAssembly
geometry workers, downloads a 3MF, and checks that its archive contains a triangle
mesh. This verifies export generation, not slicer compatibility or print quality.

## Mobile 3D generation

On a touch device, the maker's 3D downloads selector starts at **3MF only**.
Generate a coaster and download its 3MF. To get STL downloads, select all formats
and rebuild. This preserves model detail and color layers; it skips optional
merged STL generation and parts ZIP creation when 3MF is all you need. Progress
messages identify the base, color layers and archive-packing stages. Keep the
tab open: background execution and memory limits still vary by phone.

The browser suite checks a touch-device viewport with 4× CPU throttling, validates
the downloaded archive, and compares its model XML exactly with full-output mode.
This is not proof of performance on actual phones or all artwork. Re-test an
image that previously timed out to judge the practical improvement. These GitHub
changes need updating on the server before they affect dev.jamboodle.com.

## Optional 3MF credit-accounting trial

This is disabled by default and does not enable real charges. Use
`ENABLE_EXPORT_CREDIT_TRIAL=1 npm run dev` to try it locally. Create a customer
account, then in a second terminal from the same checkout/DB run:

```sh
ENABLE_EXPORT_CREDIT_TRIAL=1 node server/index.mjs --grant-test-credits test@example.com 10
```

Replace the example email with the test account you created. This operator-only
command grants test credits; there is no public grant endpoint. Generate a 3MF,
choose Download, and check the cost/balance dialog. Cancel before confirming to
spend nothing. Confirm records the debit; **Download ready file** then starts
the browser download with a fresh click for mobile browser compatibility.
Repeated clicks on that ready file and retries of identical bytes do not debit
again. Try insufficient balance and check the account's test export history.
A rebuilt file may have different bytes and count as a new export.

The browser tests simulate a lost debit response, then retry and verify exactly
one ledger debit. Empty/missing ready files and failed builds do not initiate
a debit. A browser download interruption after confirmation is handled through
free retries of the ready file, not a claim that the server can verify local
file saving. Keep the file/page available for that retry.

This prototype covers direct .3mf downloads. SVG, STL, individual-model ZIP and
legacy/release paths remain unchanged. The browser holds the generator and
reports its file fingerprint and coaster count; these are not trusted proof
of fulfillment or enforceable paid access. Do not use the trial as a production
paywall or with real customer funds. Live billing and server-authorized delivery
need a separate implementation. The hosted development service stays unaffected
until updated and explicitly configured with this feature flag.

## Updating the hosted preview

The repeatable server updater is documented in DEPLOYMENT.md. One-time read-only
GitHub access and installation are required; it is not installed by a GitHub push.
After that, `coasterlab-update` fetches, tests and installs new code, restarts the
service and checks the local and public endpoints. No repeated ZIP downloads.
