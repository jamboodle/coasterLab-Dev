#!/usr/bin/env python3
"""Promote the deployed development commit, never untested GitHub HEAD."""
import fcntl
import os
from pathlib import Path
import pwd
import re
import runpy
import shutil
import subprocess
import sys
import tempfile

base_path = Path(__file__).with_name('coasterlab-update.py')
if not base_path.is_file():
    base_path = Path(__file__).with_name('coasterlab-update')
BaseUpdater = runpy.run_path(str(base_path))['Updater']


class ProductionUpdater(BaseUpdater):
    app = Path('/home/jamboodle/coasterprint')
    development = Path('/home/jamboodle/coasterlab-dev')
    service_name = 'coasterprint-node'
    origin = 'https://coasterprint.com'
    port = 30002

    def prepare(self):
        if not self.app.is_dir() or self.app.is_symlink():
            raise RuntimeError('Expected the existing production directory, not a symlink.')
        if not (self.source / '.git').is_dir() or self.source.is_symlink():
            raise RuntimeError('Expected the existing deployment checkout.')
        revision = (self.development / '.deployed-commit').read_text().strip()
        if not re.fullmatch(r'[0-9a-f]{40}', revision):
            raise RuntimeError('Invalid development release marker. Run coasterlab-update first.')
        resolved = self.as_user(['git', 'rev-parse', '--verify', revision + '^{commit}'], self.source, True)
        if resolved != revision:
            raise RuntimeError('Development release commit was not found.')
        if not BaseUpdater().healthy():
            raise RuntimeError('Development health check failed; production was not changed.')
        print('Promoting development release: ' + revision[:12], flush=True)
        stage = Path(tempfile.mkdtemp(prefix='coasterprint-publish-'))
        self.stage = stage
        identity = pwd.getpwnam(self.user)
        os.chown(stage, identity.pw_uid, identity.pw_gid)
        archive = stage / 'release.tar'
        self.as_user(['git', 'archive', '--format=tar', '--output', archive, revision], self.source)
        self.as_user(['tar', '-xf', archive, '-C', stage])
        archive.unlink()
        return revision, stage


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run coasterprint-publish in the server root terminal.')
    for program in ['runuser', 'git', 'rsync', 'tar', 'systemctl']:
        if not shutil.which(program):
            raise RuntimeError('Required server tool is missing: ' + program)
    updater = ProductionUpdater()
    if not Path(updater.node).is_file():
        raise RuntimeError('Webuzo Node.js 24 binary not found.')
    # Share development lock so an update cannot change its release mid-promotion.
    with open('/run/lock/coasterlab-update.lock', 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another development update or production publish is running.') from None
        updater.deploy()


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError) as error:
        print('Publish failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
