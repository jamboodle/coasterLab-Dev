# Separate production deployments

Development stays at https://dev.jamboodle.com, in
`/home/jamboodle/coasterlab-dev` on port 30001 (`coasterlab-dev-node`).
Production is https://coasterprint.com, in `/home/jamboodle/coasterprint` on
port 30002 (`coasterprint-node`). Both currently run as `jamboodle`; Webuzo's
production domain account is `coasterprint`. Each app has its own `.data` database.
Production mail configuration is `/etc/coasterprint/mail.env` through the
service's `30-mail.conf` drop-in. Do not copy development service settings.

## Install the production command once

In the root terminal, after fetching this release into the existing source checkout:

```sh
install -o root -g root -m 0755 /home/jamboodle/coasterlab-source/scripts/coasterlab-update.py /usr/local/sbin/coasterlab-update
install -o root -g root -m 0755 /home/jamboodle/coasterlab-source/scripts/coasterprint-publish.py /usr/local/sbin/coasterprint-publish
```

The two installed scripts must be kept together. The publisher reuses the installed
development updater's validation, protected file-copy logic, and service handling.

## Routine updates

1. Run `coasterlab-update` in the root terminal to update development from GitHub.
2. Test changes at dev.jamboodle.com.
3. When satisfied, run `coasterprint-publish` in the root terminal.

Publishing uses the exact commit recorded in development's `.deployed-commit`,
not a newer GitHub or checkout HEAD. It checks development health, archives that
commit from the existing checkout, validates the maker build and backend tests,
then briefly stops production to copy code and restarts it. Both update commands
share a lock. No new backup archive is created.

Production `.data/`, `.env*`, local files and systemd/mail settings are preserved.
It does not copy development accounts, credits or mail configuration. Production
gets its own release marker only after loopback and public HTTPS readiness pass.
Already deployed healthy commits do not restart production. A failed copy still
attempts to restart the service, but there is no automatic code rollback.

If a check fails, inspect `journalctl -u coasterprint-node -n 40 --no-pager`.
Billing remains disabled; the current backend only supports test-mode payments.
