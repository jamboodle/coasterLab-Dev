# Administration and credit policy

Deploy to development with `coasterlab-update`, then test before using
`coasterprint-publish`. Each environment has its own admins, settings, users and
credit ledger. Billing defaults to off. The old `ENABLE_EXPORT_CREDIT_TRIAL`
service flag no longer controls the hosted application; the admin setting does.

## Bootstrap an administrator

Register your email through the site's normal account page first. In the server's
root terminal, run the following, replacing the email with your registered email:

```sh
runuser -u jamboodle -- sh -c 'cd /home/jamboodle/coasterlab-dev && /usr/local/apps/nodejs24/bin/node server/index.mjs --make-admin YOUR_EMAIL'
```

Sign in again at https://dev.jamboodle.com/admin/. Granting the role revokes existing
sessions. There is no default password or public endpoint to grant admin access.
For production, after publishing, use `/home/jamboodle/coasterprint` in the command
and https://coasterprint.com/admin/. Development admin access is not copied.

## Admin panel

- Search users, view their balance and verification state, suspend or restore access.
  Suspension revokes sessions and development tokens. The email identity remains
  reserved; a suspended user cannot register a replacement account with it.
- Add or remove integer credits with a reason. Adjustments are transactional,
  idempotent on retries, recorded in an audit log, and cannot overdraw a balance.
- Turn billing off or on. Off means logged-in users export 3MF free; on means one
  credit per coaster, including each coaster in a batch. STL is always free.
- Edit all three USD credit packs without changing source code. Defaults are 10 credits for $5 (existing starter pack), 50 credits for $10, and 100 credits for $15. Existing starter-pack customizations are preserved. Customers select a pack on the account/pricing page. Each pack has an independent checkout retry reference; the server determines its amount and credits, and records both on the order.
- Replace Stripe test secret and webhook keys without code or service restarts.
  Secret values are write-only from the panel and are not included in audit output.
  They are stored in the protected `.data/credits.sqlite` database, not encrypted
  separately; restrict OS/database access. Blank inputs keep the existing keys.
  Stored values override service environment keys. Live Stripe keys remain
  unsupported until the separate live billing work is completed.
- Business identity, bank and payout changes are made in Stripe's own dashboard,
  linked from Payments. These details are not collected or stored by CoasterPrint.

Existing checkout attempts keep their original amount, currency and credit count
when prices change. Turning billing off blocks new checkout attempts but still
accepts authenticated payment notifications for earlier purchases. Changing Stripe
accounts or signing secrets while payments are outstanding needs a planned
cutover; support for overlapping provider credentials is not implemented yet.

## Customer behavior

New registrations receive exactly 15 welcome credits transactionally. Existing
accounts are not retroactively granted credits. Email uniqueness is enforced after
trimming and lowercasing; registering the same address again cannot get another
welcome grant. Distinct aliases are distinct email addresses; this is not an
identity verification system or a guarantee against people using multiple emails.

The maker shows account balance and refreshes it when the tab regains focus or an
export is recorded. Login responses also include the current balance.
All current maker 3MF routes, including individual-file ZIPs, use the account/credit
confirmation. Free STL ZIPs contain no 3MF. Anonymous 3MF attempts prompt sign-in or
registration. Insufficient-credit notices link to the free STL option and the
credit purchase section. The free-STL action directly packages the existing base and color parts as a ZIP, with import instructions and no rebuild or sign-in step. Merged STL is not offered. A freshly requested quote/debit checks current settings;
retries of the same bytes do not debit twice.

Generation still runs locally in the browser. This change provides the supported
UI flow and authoritative ledger debits, not tamper-proof paid file delivery.
A determined user can bypass client controls or use previously distributed
standalone exports. Server-controlled production delivery remains billing work;
do not treat these controls as a secure paid-download boundary.
