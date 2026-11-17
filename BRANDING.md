# CoasterPrint

Public brand: **CoasterPrint**. Intended public domain: **coasterprint.com**.

The maker, account/pricing pages, recovery and verification pages, email sender
name/subjects/body, generated SVG/STL/3MF metadata, download filenames, and supplied
first-party release bundles use the new name. Third-party licenses are unchanged.
Old release and holder ZIP URLs redirect to their renamed counterparts. The legacy
SVG metadata reader and browser checkout-key migration preserve older data.

## Deployment: refresh the installed updater once

The root-owned updater currently installed on the server checks for the old page
title. Install the brand-independent version **before** deploying this rebrand.
Run this block in the server root terminal instead of the normal update command:

```sh
(
set -e
coaster_source=/home/jamboodle/coasterlab-source
if [ -n "$(runuser -u jamboodle -- git -C "$coaster_source" status --porcelain)" ]; then
  echo "Deployment checkout has local changes. Stop here; do not overwrite them."
  exit 1
fi
runuser -u jamboodle -- env \
  GIT_SSH_COMMAND='ssh -i /home/jamboodle/.ssh/coasterlab_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/home/jamboodle/.ssh/coasterlab_known_hosts' \
  git -C "$coaster_source" pull --ff-only origin main
install -o root -g root -m 0755 \
  "$coaster_source/scripts/coasterlab-update.py" /usr/local/sbin/coasterlab-update
coasterlab-update
)
```

After that one-time refresh, `coasterlab-update` works normally for future changes.
It now checks the app's structural markers and health endpoints, not its brand.
Existing checkout paths, database, systemd service, GitHub repository identity,
SSH key names and update command are intentionally retained so the running
installation and accounts are preserved. Do not blindly rename those resources.

## New domain and email address

Changing branding does not provision a domain or rewrite systemd configuration.
Until the new domain is configured, the development site and account links
continue using https://dev.jamboodle.com and the current working envelope sender.
Emails will display CoasterPrint, but their address is still the configured
EMAIL_FROM (currently noreply@jamboodle.com on the development server).

Before switching to noreply@coasterprint.com:

1. Point coasterprint.com to the intended server, add it to Webuzo, configure
   its app proxy and issue HTTPS certificates.
2. Create the noreply@coasterprint.com mailbox/alias and configure that domain's
   email signing and sender authentication in Webuzo/DNS. Preserve existing
   records; validate actual SPF, DKIM and DMARC results.
3. Once the new website is reachable, set APP_ORIGIN=https://coasterprint.com in
   the service configuration and EMAIL_FROM=noreply@coasterprint.com in the
   protected mail environment file. Reload/restart systemd and test both email
   flows from the new origin.
4. Redirect the old development host when appropriate, so old account links and
   bookmarks arrive at the active origin rather than failing origin checks.

Do not change the working sender or account-link origin prematurely: domain and
mail delivery must be verified separately from the code rebrand. Real payments
remain disabled throughout this change.
