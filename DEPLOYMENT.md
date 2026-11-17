# One-command development updates

Target: `dev.jamboodle.com`, app `/home/jamboodle/coasterlab-dev`, systemd service
`coasterlab-dev-node`, loopback port 30001. Webuzo's per-domain proxy and TLS remain
unchanged. Do not run Webuzo's separate application process alongside systemd.

After the one-time Git setup, run this in the server's root terminal:

```sh
coasterlab-update
```

The updater fetches `main` from this private GitHub repository, requires a clean
fast-forward-only deployment checkout, stages the exact commit, and validates
maker assets plus all backend tests before stopping the working service. It then
merges code into the existing app, starts the service, and verifies both local
and public health plus the public CoasterLab homepage. It records the installed
SHA in `.deployed-commit`. Repeating an already healthy revision does not restart
it. A lock prevents concurrent update jobs.

Accounts/balances under `.data/`, `.env*`, and Git metadata are excluded from file
updates; rsync does not delete local files. Systemd environment flags are not
changed. Git, tests, extraction, code copying and version-marker writes run as
`jamboodle`, not root. The installed updater itself and service controls are owned
by root. The root copy does not silently replace itself from the application repo.
No new backup archives are created, per the owner's preference. This is not an
atomic release switch or automatic code/database rollback. Failed preflight checks
leave the service untouched; copy failure attempts to restart the service and is
reported as failure. Failed readiness never records a successful deployment.

## 1. Read-only repository access (one time)

In the server root terminal, create a dedicated key without replacing an existing
one and display only its public half:

```sh
runuser -u jamboodle -- sh -c 'umask 077; mkdir -p /home/jamboodle/.ssh; if [ ! -f /home/jamboodle/.ssh/coasterlab_deploy ]; then ssh-keygen -q -t ed25519 -N "" -f /home/jamboodle/.ssh/coasterlab_deploy -C coasterlab-dev-server; fi; cat /home/jamboodle/.ssh/coasterlab_deploy.pub'
```

Add that public key in GitHub repository **Settings → Deploy keys → Add deploy key**.
Use a descriptive title and leave **Allow write access** unchecked. Never share
or upload the private file (the path without `.pub`).

## 2. Trust GitHub and clone the deployment checkout

Run this after the key is registered. GitHub host keys are obtained through its
TLS-verified official metadata API; SSH host checking is never disabled. Existing
known-host settings and unrelated SSH keys are not changed.

```sh
runuser -u jamboodle -- python3 - <<'PY'
import json, os, subprocess, urllib.request
from pathlib import Path
ssh = Path('/home/jamboodle/.ssh')
known = ssh / 'coasterlab_known_hosts'
if not known.exists():
    with urllib.request.urlopen('https://api.github.com/meta', timeout=20) as response:
        keys = json.load(response)['ssh_keys']
    if not keys or not all(isinstance(key, str) and '\n' not in key for key in keys):
        raise RuntimeError('Invalid GitHub host-key metadata')
    with known.open('x') as output:
        output.write(''.join('github.com ' + key + '\n' for key in keys))
    known.chmod(0o600)
source = Path('/home/jamboodle/coasterlab-source')
if source.exists():
    raise RuntimeError('Deployment checkout already exists. Do not replace it blindly.')
environment = dict(os.environ)
environment['GIT_TERMINAL_PROMPT'] = '0'
environment['GIT_SSH_COMMAND'] = ('ssh -i /home/jamboodle/.ssh/coasterlab_deploy '
    '-o IdentitiesOnly=yes -o StrictHostKeyChecking=yes '
    '-o UserKnownHostsFile=/home/jamboodle/.ssh/coasterlab_known_hosts')
subprocess.run(['git', 'clone', '--branch', 'main', '--single-branch',
    'git@github.com:jamboodle/coasterLab-Dev.git', str(source)],
    env=environment, check=True)
PY
```

## 3. Install the updater (one time)

As root:

```sh
install -o root -g root -m 0755 /home/jamboodle/coasterlab-source/scripts/coasterlab-update.py /usr/local/sbin/coasterlab-update
coasterlab-update
```

Requirements: Python 3, Git, rsync, tar, runuser, systemd, the existing app service,
and `/usr/local/apps/nodejs24/bin/node`. No new package dependencies are needed
by this app. The prepared server already used rsync for its manual update.

Use systemd for lifecycle commands, not the old Webuzo start/stop buttons:

```sh
systemctl status coasterlab-dev-node --no-pager
systemctl restart coasterlab-dev-node
journalctl -u coasterlab-dev-node -n 30 --no-pager
```

## Test-credit flag is separate

Updating code does not enable test credits or live billing. To enable the optional
3MF accounting trial after deployment, add
`Environment=ENABLE_EXPORT_CREDIT_TRIAL=1` to a service drop-in with
`systemctl edit coasterlab-dev-node`, then reload/restart the service. Real Stripe
and public email settings remain separate. See TESTING.md before enabling this
prototype; it is not production payment enforcement.

## Verification limits

The local updater tests exercise preflight ordering, preservation, failed copies,
failed health checks, and no-op updates using temporary files and substituted
service/rsync operations. They do not establish GitHub SSH access, real systemd
behavior or a deployment on the hosting server. First successful server execution
must be verified there before calling this update method installed.
