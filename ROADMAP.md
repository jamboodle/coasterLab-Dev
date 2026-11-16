# Monetization roadmap

## First priority: export credits and pricing flow

Selected by the owner. Pricing below is a hypothesis to test, not a live offer.

- Keep image upload, tracing, and preview free and local in the browser.
- [x] Prototype a pricing flow with a $5 pack of 10 exports and an in-memory simulator.
- [ ] Decide the number of free
  exports and the definition of one billable export before enforcing credits.
- Establish a source/build workflow before modifying release assets.
- [x] Add a persistent SQLite credit ledger and development bearer-token authentication.
- [x] Add opt-in customer email/password registration, sign-in, throttling and session lifecycle.
- [x] Add current-password-verified password changes, sign out everywhere and account credit activity.
- [ ] Add email verification, forgotten-password recovery and account deletion before public launch.
- [x] Implement Stripe test checkout adapter and signed, idempotent payment webhooks; mocked integration tests pass.
- [ ] Validate real Stripe sandbox checkout and webhook delivery with secure credentials.
- [x] Connect test checkout and server account balance to an opt-in development panel using expiring, revocable HttpOnly sessions.
- [x] Add customer sign-in beside the optional development account flow.
- [x] Add persistent checkout retry keys, account-scoped confirmation status and delayed webhook UI.
- [ ] Validate real sandbox checkout and webhook delivery.
- Show the balance and cost before export. Keep canceled/failed payments and failed
  exports from consuming credits; support webhook retries and duplicate callbacks.
- Decide how to enforce paid exports while retaining local image processing. The
  imported client already contains working export code; a client-side button lock
  alone cannot enforce payment. Describe privacy accurately if server processing
  becomes necessary.
- Validate successful purchase, cancellation, declined payment, duplicate webhook,
  insufficient balance, failed export, and concurrent exports before launch.
- Measure successful previews, export intent, checkout starts, paid purchases, and
  export completion without uploading customer artwork into analytics.

Decisions required before live payments: payment provider and merchant account,
backend hosting, identity provider, free allowance, credit/refund rules, currency,
and tax handling. Enter all credentials through secure environment settings.

## Follow-on experiments

| Offer | Value to test | Proposed price hypothesis |
| --- | --- | --- |
| Pro subscription | Saved projects/palettes/presets and improved batch workflow | $8–12/month |
| Commercial maker plan | Seller batch variants, branding and organized exports | $19–29/month |
| Original design packs | Licensed coordinated artwork and holder designs | $4–12/pack |
| Physical orders | Printed coasters supplied directly or by a partner | Determine from costs |

Batch functionality already exists in the imported app; inventory and improve it
before promising new capabilities. Commercial plan terms cannot grant rights to
third-party images customers upload. Confirm rights for any sold design packs.

## Repository migration

- [x] Import owner-supplied r27 complete project; preserve original dist layout, assets, historical releases and license files.
- [x] Document local startup and monetization priorities.
- [x] Push standalone r27 history to `jamboodle/coasterLab-Dev` on GitHub.
- [ ] Attach the development repository to the cloud environment.
- [ ] Establish asset regeneration and automated CI before paid feature development.

Git remote: https://github.com/jamboodle/coasterLab-Dev.git (main).
Use this repository as the development source. The Sites-managed repository and
the website deployment copy are separate and do not synchronize automatically.
