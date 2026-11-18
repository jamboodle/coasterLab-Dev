# Independent production deployments

After the one-time [account migration](ACCOUNT-SEPARATION.md), development stays
at https://dev.jamboodle.com under `jamboodle`, and production runs entirely under
Webuzo's `coasterprint` account:

| Item | Production location |
| --- | --- |
| Website | `https://coasterprint.com` |
| Public assets | `/home/coasterprint/public_html` |
| Private app | `/home/coasterprint/app` |
| Customers, balances and payment settings | `/home/coasterprint/app/.data/credits.sqlite` |
| Service | `coasterprint-node`, user `coasterprint`, loopback port 30002 |
| Mail configuration | `/etc/coasterprint/mail.env` |
| Release packages | `/var/lib/coasterprint/releases` (root only) |

`STATIC_ROOT` points to public_html; `DATABASE_PATH` points to the private database.
Passwords, payment keys and customer data must never be placed in public_html.
The migration retains existing mail/live-payment service drop-ins and proxy/SSL.

## Routine updates

1. In the root terminal, run `coasterlab-update` to update development and package
   that exact healthy revision in the root-owned release store.
2. Test changes at dev.jamboodle.com.
3. Run `coasterprint-publish` to deploy the prepared package to production.

The publisher does not read development folders, use its GitHub checkout, or
import the development updater. It validates the package's SHA-256, archive
contents, maker build and backend tests as `coasterprint`, briefly stops the
production service, copies private code and public assets, restarts, and checks
loopback and public HTTPS health. Its release marker updates only after checks
pass. A healthy already-deployed revision does not restart production.

Production `.data/`, `.env*`, local files, service/mail settings and `.well-known/`
are preserved. No development accounts or credits are copied. Routine updates do
not create backup archives. Failed copying still attempts to start the service;
there is no automatic code rollback. Inspect failures with
`journalctl -u coasterprint-node -n 40 --no-pager`.

## Releases from another owner or build server

Production can accept a package without any development account on the server:

```sh
coasterprint-publish FULL_40_CHARACTER_COMMIT --archive /path/to/release.tar --sha256 EXPECTED_SHA256
```

Create the tar from the approved Git revision (`git archive --format=tar COMMIT`),
with its built assets committed. Transfer it through a trusted channel and verify
the supplied digest. It must contain regular project files, no links, secrets,
Git internals or customer data. SHA-256 detects changes; the operator remains
responsible for approving the package's source. Installed root helpers are in
`/usr/local/sbin/` and `/usr/local/lib/coasterprint/`, independent of either home.

Live payment configuration is documented in [LIVE-PAYMENTS.md](LIVE-PAYMENTS.md).
