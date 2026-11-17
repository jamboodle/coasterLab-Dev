# Private, account-bound 3MF delivery

## Deployment

Deploy to development first with `coasterlab-update`. Then, in the root terminal:

```sh
python3 /home/jamboodle/coasterlab-dev/scripts/configure-export-proxy.py development
```

This adds a 32 MiB upload bound, 30-second idle upload timeout, and 90-second proxy
response/send timeouts to the existing Webuzo domain include. It tests nginx and
restores the original file if validation/reload fails. It is idempotent; existing
custom limits require review rather than being overwritten. Do not run it for
production until the release has been tested and published. Later, the production
command is:

```sh
python3 /home/jamboodle/coasterprint/scripts/configure-export-proxy.py production
```

No new credentials or systemd variables are needed. The updater preserves `.data`
and settings. Database migrations add a private job table without rewriting
accounts, balances, payment settings, or admin roles.

## Flow and charging

Tracing, printable geometry and free STL parts remain local. Building does not
assemble any 3MF in the browser. A 3MF action requires an authenticated account,
serializes existing model parts in a browser worker, and sends these parts and
printer settings to `POST /api/exports`. Original image files are not uploaded.
The download block, confirmation dialog and privacy copy disclose this change.

A bounded server worker validates the model structure, base64/binary STL sizes,
triangle counts, finite coordinates, layer dimensions, colors, plate geometry and
printer settings. It derives the cost from the number of coaster assemblies (1–6),
not a client-supplied count or fingerprint. Project assembly code is server-only.
Individual-file ZIPs are also assembled server-side and cost one credit per coaster
when billing is on. Free STL ZIPs never go through these endpoints.

Prepared output is a private SQLite BLOB under `.data/credits.sqlite`. A random
job reference is not a bearer credential: preparation, quote, release and file
retrieval all require the owning account's valid session/token. All responses are
no-store. Before confirmation, `GET /api/exports/:id/file` returns 403 with no model
bytes; other accounts receive 404. Anonymous requests receive 401.

`POST /api/exports/:id/authorize` atomically debits credits and releases the file.
The server recomputes the price and requires it to match the displayed expected
cost. A changed billing switch requires a fresh confirmation. Billing off releases
without a debit. Retries/concurrent confirmations cannot charge twice. The green
Download Ready button requests the protected file directly with the account cookie,
preserving mobile browser download activation. No public asset URL is created.

Files live for up to 24 hours. At most six files / 100 MB are cached per account;
older files for that account are evicted when it prepares new exports. The global
cache is capped at 100 files / 512 MB. Entitlements remain in the ledger after files
expire/are evicted, so preparing the identical input again can be released without
another debit. A service restart preserves both files and release state.

## Bounds and compatibility

Model uploads are bounded to 32,000,000 bytes, 400,000 STL triangles and six coaster
assemblies, with 32 image color parts each. Worker preparation is limited to 60
seconds and a 256 MB old-generation heap. At most two jobs prepare concurrently,
one per account. Downloads are capped at four simultaneous responses, two per account. Accounts are limited to 20 preparations per 15 minutes. Complex
models can exceed these bounds and will fail before any debit.

Historical standalone HTML pages redirect to the current maker. Historical root
scripts outside the current manifest and old self-hosted ZIP bundles are retired
(410), including encoded URL variants. Holder downloads remain available. Existing
browser tabs using the retired scripts should reload. Hosted `/api/export-quote`
and `/api/export-debit` trial routes return 410 and cannot release new files.
Internal legacy test fixtures explicitly opt into the retired trial handler.

This protects the hosted CoasterPrint 3MF service. Free STL geometry remains
exportable, and previously downloaded standalone code cannot be recalled. Users
can convert free geometry with other software. The service counts submitted
coaster assemblies; no system can infer the number of original images from
arbitrarily edited meshes. This is not DRM against manual model editing/conversion.
Live Stripe support is separately gated and disabled by default; see LIVE-PAYMENTS.md.

## Verification

Backend checks cover ownership, unauthorized access, pending-file denial, count
forgery, invalid geometry, credit changes, insufficient balance, duplicate/concurrent
release, cache expiry, free regeneration, restart persistence and retired assets.
Browser checks cover actual PNG→geometry→private 3MF, model geometry across desktop
and mobile, lost confirmation responses, repeat downloads, six-coaster cost,
individual ZIP cost and free local STL fallback.

Export bridge, dialog and packing worker assets are content-addressed together. Packing messages include an explicit protocol version; mismatched cached workers show a reload message rather than interpreting the request as an STL-parts job. Editable sources are in `src/maker/`, and `npm run build` updates the full dependency graph and current HTML.
