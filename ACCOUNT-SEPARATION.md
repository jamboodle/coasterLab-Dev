# Move production into its own hosting account

This procedure corrects the original production layout under
`/home/jamboodle/coasterprint`. It is a move of the existing production app and
customer database, not a new installation and not a redirect. Development remains
unchanged under `jamboodle`. Until this procedure succeeds, production still uses
the old location.

## Run in the hosting server's root terminal

First retrieve the migration tools through the existing development update:

```sh
coasterlab-update
python3 /home/jamboodle/coasterlab-dev/scripts/migrate-production-account.py
```

The second command only checks the actual server layout. It refuses unexpected
service/account settings, existing destination app files, custom website content,
or service references that would keep production dependent on the old account.
If it passes, perform the move:

```sh
python3 /home/jamboodle/coasterlab-dev/scripts/migrate-production-account.py --apply
```

The helper stages existing production code, enables a brief maintenance response,
stops production, and copies its final SQLite database including any WAL. It
compares database hashes, checks SQLite integrity, changes the service to run as
`coasterprint`, and verifies the new runtime paths and homepage before reopening.
Public assets go to `/home/coasterprint/public_html`; private code, environment
files, customers, credits, pending orders and payment settings go to
`/home/coasterprint/app`. The copied entry point gains `STATIC_ROOT` support when
needed; no new application features are published by the move.

The domain, certificate, port 30002, public proxy, email configuration and live
payment settings stay in place. Failures before reopening restore the previous
service, proxy and website defaults; candidate files remain for diagnosis. Do not
blindly delete or overwrite those files to retry.

The old production directory is moved out of `jamboodle`'s home to a root-only
rollback location under `/var/lib/coasterprint/migration/`. This temporary safety
copy contains live customer data and must stay private. Its exact location is
printed after success. Remove it only after verifying the moved site and deciding
a rollback is unnecessary. Existing historic backups may also contain production
data; review them separately before transferring ownership.

## Verify the move

```sh
systemctl show coasterprint-node -p User -p WorkingDirectory --no-pager
curl --max-time 15 -fsS https://coasterprint.com/health
```

Expect user `coasterprint`, working directory `/home/coasterprint/app`, and health
`ok: true`. Sign in with an existing customer account, check its balance and admin
settings, then test email and an export. The old production folder should no
longer exist under `jamboodle`.

The helper installs independent production publishing and updates the development
command to produce root-owned release packages. Future updates follow
[PRODUCTION.md](PRODUCTION.md). Production can import a release from another build
server without access to the `jamboodle` account.

## Future ownership transfer

Separate Unix accounts keep production operational without the development home.
They do not transfer domain registration, DNS, source repository ownership, or the
Stripe merchant account. The current Stripe merchant account also serves another
site. A future owner must connect their own Stripe keys/webhook and business
settings through production administration, and arrange domain/source transfers.
Both hosting accounts are still administered by this server's root operator.
