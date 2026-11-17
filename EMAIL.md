# Hosted account email

CoasterPrint supports the existing Webuzo Exim/Sendmail-compatible local mail
service. It does not require an SMTP password or a new package dependency.
The application submits verification/reset mail as the `jamboodle` service user;
the mail server handles delivery, queue retries, domain signing and bounces.

The sender name and email text are CoasterPrint. The new target address is
noreply@coasterprint.com, but the existing development server keeps its configured
sender until that domain/mailbox is ready. See BRANDING.md before changing the
working address or APP_ORIGIN.

## Before enabling

- Update the server with `coasterlab-update`.
- In Webuzo, create or confirm `noreply@coasterprint.com` as a mailbox/alias so it can
  accept bounces. Keep any mailbox password private; the app does not need it.
- Confirm a working Sendmail-compatible executable is accessible to `jamboodle`.
  The observed server has `/usr/sbin/sendmail` and a Webuzo Exim binary at
  `/usr/local/apps/exim/bin/exim`; the paths must resolve to executable files.
- Keep APP_ORIGIN=https://dev.jamboodle.com in the existing systemd service.

## Configuration

Use these non-secret values in a root-owned environment file outside the app:

```ini
EMAIL_TRANSPORT=sendmail
EMAIL_FROM=noreply@coasterprint.com
SENDMAIL_PATH=/usr/sbin/sendmail
```

Set SENDMAIL_PATH to the verified executable on this host. Suggested file:
`/etc/coasterlab-dev/mail.env`, owner root, permissions 0600. Reference it using a
service drop-in at
`/etc/systemd/system/coasterlab-dev-node.service.d/30-mail.conf`:

```ini
[Service]
EnvironmentFile=/etc/coasterlab-dev/mail.env
```

Run `systemctl daemon-reload` and `systemctl restart coasterlab-dev-node`, then
check `/api/config`: emailEnabled should be true, developmentInbox false, and
paymentsEnabled should remain false. An explicitly configured missing mailer,
invalid sender, or non-HTTPS origin fails startup instead of claiming readiness.
Do not enable ENABLE_DEV_INBOX on the hosted site.

Systemd reads the environment file as root and supplies the variables to Node.
The one-command updater does not replace the file or drop-in. To disable mail,
set EMAIL_TRANSPORT=disabled and restart the service; accounts remain intact.

## What is sent

- Registration requests a verification email; existing users can use Send
  verification link on the account page.
- Verification links expire in 24 hours. Reset links expire in 30 minutes.
- Mail is branded plain-text MIME with UTF-8/base64 encoding and an HTTPS link.
- Link tokens are in the URL fragment. Message bodies, tokens and mail-server
  diagnostics are not logged or returned through the API.
- Envelope/header addresses reject injected headers. No shell is used to invoke
  the mail program; recipients are separate arguments after `--`.
- The `-odb` delivery option requests background delivery. Submission has a
  15-second limit. Successful submission means the local MTA accepted it,
  not that the recipient's inbox has received it.

If submission fails, registration still creates the account and the UI offers
resending verification. Resend reports a temporary error. Forgotten-password
requests retain the same public response for known/unknown accounts and transport
failures. A generic diagnostic, without addresses, tokens or MTA stderr, is logged
for the operator. No automatic application-level retry issues extra links.

## Verify on the real server

1. Sign in with an account whose inbox you can check and request verification.
2. Confirm the message arrives; check spam as well as the inbox. Its link must
   begin with https://dev.jamboodle.com/account/#verify=.
3. Open the link, select Verify my email, and return to the account page to
   confirm the verified state.
4. Request a password reset and verify receipt, successful sign-in with the new
   password, and rejection of the reused reset link.
5. Inspect the received message's authentication results. SPF/DKIM/DMARC setup
   belongs in Webuzo/DNS and must be validated against the actual domain records;
   do not replace existing DNS records with guessed values.

Local automated tests use a child-process mail sink, never an external recipient.
They verify MIME, arguments/stdin, injection rejection, submission failure and
expiry, transport configuration and API failure semantics. Real Exim delivery,
spam placement and sender authentication require the above hosted checks.
