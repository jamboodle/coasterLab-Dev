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
For production, after the [account migration](ACCOUNT-SEPARATION.md), use
`runuser -u coasterprint`, working directory `/home/coasterprint/app`, and
https://coasterprint.com/admin/. Development admin access is not copied.

## Admin panel

- Use the Users table to search names/emails and sort by name, joined date, last visited date, or balance (ascending or descending across the full result set). Choose 10, 25, or 50 rows per page and navigate with Previous/Next or the page selector. Manage opens a compact credit/suspension dialog. Users, Billing and Audit are separate tabs.
- New registrations can supply a name; existing accounts can edit their name on the account page. Joined dates are recorded for new registrations. Old unrecorded names/dates display as Not provided / Not recorded. Last visited tracks authenticated app activity, with writes throttled to once a minute. No historical dates are invented.
- View balances and verification state, suspend or restore access.
  Suspension revokes sessions and development tokens. The email identity remains
  reserved; a suspended user cannot register a replacement account with it.
- Add or remove integer credits with a reason. Adjustments are transactional,
  idempotent on retries, recorded in an audit log, and cannot overdraw a balance.
- Turn billing off or on. Off means logged-in users export 3MF free; on means one
  credit per coaster, including each coaster in a batch, or one credit per plaque.
  Both makers spend the same account balance. STL is always free.
- Edit all three USD credit packs without changing source code. Defaults are 10 credits for $5 (existing starter pack), 50 credits for $10, and 100 credits for $15. Existing starter-pack customizations are preserved. Customers select a pack on the account/pricing page. Each pack has an independent checkout retry reference; the server determines its amount and credits, and records both on the order.
- Replace Stripe test secret and webhook keys without code or service restarts.
  Secret values are write-only from the panel and are not included in audit output.
  They are stored in the protected `.data/credits.sqlite` database, not encrypted
  separately; restrict OS/database access. Blank inputs keep the existing keys.
  Stored sandbox values override sandbox service environment keys. Live keys and
  signing secrets use separate fields, a separate production-only server permission
  and an explicit live-payments switch. See [LIVE-PAYMENTS.md](LIVE-PAYMENTS.md).
- Business identity, bank and payout changes are made in Stripe's own dashboard,
  linked from Payments. These details are not collected or stored by CoasterPrint.

Existing checkout attempts keep their original amount, currency and credit count
when prices change. Turning billing off blocks new checkout attempts but still
accepts authenticated payment notifications for earlier purchases. Changing Stripe
accounts or signing secrets while payments are outstanding needs a planned
cutover; support for overlapping provider credentials is not implemented yet.

## Customer behavior

New registrations receive the configured welcome credits transactionally (default 15). Change **New user credits** in Admin → Users & credits; 0 disables the grant. The admin setting and customer signup descriptions update without code edits or restarts. Existing
accounts are not retroactively granted credits. Email uniqueness is enforced after
trimming and lowercasing; registering the same address again cannot get another
welcome grant. Distinct aliases are distinct email addresses; this is not an
identity verification system or a guarantee against people using multiple emails.

Guests and registered accounts with a zero credit balance can import/process one image at a time. Registered accounts with a positive balance can import/process up to six images at once, even if the balance is less than six. Batch access is refreshed on import, before processing, and when the page regains focus or a debit is recorded. An existing over-limit queue is retained but cannot be rebuilt until the user removes images or restores access. Processing does not debit credits. With billing on, each image in a 3MF batch costs one credit (six images = six credits), including a ZIP of individual 3MF files. These rules appear in the download block.

The maker shows account balance and refreshes it when the tab regains focus or an
export is recorded. Login responses also include the current balance.
All current maker 3MF routes, including individual-file ZIPs, use the account/credit
confirmation. Free STL ZIPs contain no 3MF. Anonymous 3MF attempts prompt sign-in or
registration. Insufficient-credit notices link to the free STL option and the
credit purchase section. The free-STL action directly packages the existing base and color parts as a ZIP, with import instructions and no rebuild or sign-in step. Merged STL is not offered. A freshly requested quote/debit checks current settings;
retries of the same bytes do not debit twice.

3MF assembly and release now run on the server; see [SECURE-EXPORTS.md](SECURE-EXPORTS.md)
for the deployment proxy step, privacy changes, retention and limits. Free STL
geometry remains local and can be converted in other software. Live billing is
off by default and require production activation; see [LIVE-PAYMENTS.md](LIVE-PAYMENTS.md).

## Artwork library

Upload PNG, JPG or WebP files (up to 20 MB each) into the `artwork/` directory next to
the environment's credits database. Use one level of folders to assign categories
(for example, `artwork/Animals/Fox.png`). Files directly in `artwork/` appear under
General. Start with artwork you intend to make public. File names become design
titles, and reindexing sends image contents to OpenAI to generate public search
tags. The library detects each image format from the file contents, including
WebP saved with a .png extension. The browser converts a selected WebP to PNG
for the maker while leaving the stored artwork intact. Upload files under a temporary extension and rename them when complete.

| Environment | Default artwork path | Service |
| --- | --- | --- |
| Development | `/home/jamboodle/coasterlab-dev/.data/artwork/` | `coasterlab-dev-node` |
| Production | `/home/coasterprint/app/.data/artwork/` | `coasterprint-node` |

On each server service, set `OPENAI_API_KEY` using its own root-owned mode-0600
systemd environment file outside the app and web root. For example, create
`/etc/coasterlab-dev-artwork.env` for development, containing
`OPENAI_API_KEY=<development key>`, and add this drop-in with
`systemctl edit coasterlab-dev-node`:

```ini
[Service]
EnvironmentFile=/etc/coasterlab-dev-artwork.env
```

Use a separate file and key for `coasterprint-node`. Reload systemd and restart
only the service being configured. The app user needs read access to uploaded
images and write access to the database directory. Keep these directories
outside the public document root.

After uploads, removals or replacements, sign in to that environment's
`/admin/`, open **Artwork**, and click **Reindex**. The status reports the
last completed scan, tagged designs, skipped files and tag failures. Images
with a failed tag request can still be found by title or category. Reindexing
retries failed requests and reuses tags for unchanged image contents. The app
writes `artwork-index.json` alongside the database. Both deployment commands
preserve this runtime directory, and each environment has its own uploads
and index.

Test development with the normal `coasterlab-update` workflow. Confirm
`/api/artwork` returns JSON through the site's existing API proxy, that
the maker opens the library, and that desktop and mobile selections land
in the maker preview. Publish the tested revision with `coasterprint-publish`.
Configure and index production's own artwork there.

## Resources

Create the production upload directory from the server root terminal:

```sh
install -d -o coasterprint -g coasterprint -m 0755 /home/coasterprint/public_html/resource-images
```

Upload PNG or WebP images there as the `coasterprint` account. Nested folders become searchable categories. On development with the default static root, use `/home/jamboodle/coasterlab-dev/dist/resource-images/` and upload as `jamboodle`. Git ignores that folder and the deployment sync preserves uploaded files.

The server's `python3` needs Pillow with WebP support. On Debian or Ubuntu, install `python3-pil` through the system package manager. The Node service uses its existing `OPENAI_API_KEY` setting. Upload files before starting the scan and leave them in place until it finishes.

In Admin, open **Resources** and click **Validate, convert and reindex**. The scan validates PNGs, replaces valid single-frame WebP files with PNGs, and then sends the valid images to OpenAI for visual search tags. A WebP with a `.png` suffix is fixed in place. A `.webp` file is replaced by a same-named `.png` after conversion, provided the destination is free. Keep an original copy if you need WebP metadata or compression. Invalid files, animation, and filename collisions are listed as skipped. The private index caches tags by image content and is separate from the Artwork Library. Existing tagged images use cached tags on later runs.
