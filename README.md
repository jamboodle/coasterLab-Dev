# CoasterLab

Development repository: https://github.com/jamboodle/coasterLab-Dev (branch `main`).

Standalone development copy of the CoasterLab browser application, imported from
the owner-supplied r27 complete project ZIP, identified as Sites commit
`9c365be25cc14d218857750d743f1f40dbf2b69e`. The initial r25 import is retained
in local Git history. The inaccessible Sites commit has not been independently verified.
The original website checkout and its deployed copy are preserved.

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

## Imported assets

`dist/index.html` loads fingerprinted JavaScript files listed in `dist/asset-manifest.json`.
Those scripts also reference fingerprinted workers and modules. Unhashed files and historical hashed assets coexist in the export. Do not assume editing an unhashed
file changes the running app. Preserve this working baseline until a source and
asset generation workflow is established and tested. The `dist/downloads/` release archives are imported artifacts; they are not automatically rebuilt. Existing vendor and font license
files are retained; this import does not assign a new license to the application.

## Next development

See [ROADMAP.md](ROADMAP.md). The first selected priority is export credits and the
pricing flow. Payments, accounts, credit accounting, and export enforcement are not
implemented in this baseline. No production deployment is configured here.

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
The pricing simulator remains separate. No live payment, customer sign-in, or
paid export enforcement is enabled. CI runs the backend tests on pushes and PRs.
