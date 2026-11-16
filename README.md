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
