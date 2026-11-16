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
