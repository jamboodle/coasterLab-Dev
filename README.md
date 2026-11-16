# CoasterLab

Standalone development copy of the CoasterLab browser application, imported from
`jamboodle/website`, commit `eed8362b5cee7ffd875c23aaf3d8e95db4cd73c5`, directory `coasterlab/`.
The original website checkout and its deployed copy are preserved.

## Develop

Use this existing checkout; no additional worktree is needed.
No application dependencies, build, credentials, or database are needed for the current app.

```sh
cd /workspace/coasterlab
python3 -m http.server 3001 --bind 0.0.0.0
```

Open the root page through your development environment. Browser validation uses the
provided Node, Playwright and `/usr/bin/chromium`:

```sh
SITE_URL=http://127.0.0.1:3001 node scripts/smoke.cjs
```

## Imported assets

`index.html` loads fingerprinted JavaScript files listed in `asset-manifest.json`.
Those scripts also reference fingerprinted workers and modules. Some unhashed files
contain older worker URLs and cache query strings. Do not assume editing an unhashed
file changes the running app. Preserve this working baseline until a source and
asset generation workflow is established and tested. `app.zip` is an imported
release archive; it is not automatically rebuilt. Existing vendor and font license
files are retained; this import does not assign a new license to the application.

## Next development

See [ROADMAP.md](ROADMAP.md). The first selected priority is export credits and the
pricing flow. Payments, accounts, credit accounting, and export enforcement are not
implemented in this baseline. No production deployment is configured here.
