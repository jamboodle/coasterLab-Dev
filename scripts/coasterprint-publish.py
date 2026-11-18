#!/usr/bin/env python3
"""Deploy a verified release package into the independent production account."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import pwd
import runpy
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

library = Path(__file__).with_name('release_artifacts.py')
if not library.is_file():
    library = Path('/usr/local/lib/coasterprint/release_artifacts.py')
artifacts = runpy.run_path(str(library))

class ProductionUpdater:
    user = 'coasterprint'
    home = Path('/home/coasterprint')
    app = home / 'app'
    public = home / 'public_html'
    node = '/usr/local/apps/nodejs24/bin/node'
    service_name = 'coasterprint-node'
    origin = 'https://coasterprint.com'
    port = 30002
    release_store = artifacts['STORE']

    def as_user(self, args, cwd=None, capture=False):
        environment = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                       'HOME': str(self.home), 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'}
        result = subprocess.run(['runuser', '-u', self.user, '--', *map(str, args)], cwd=cwd,
                                env=environment, check=True, text=True,
                                stdout=subprocess.PIPE if capture else None)
        return result.stdout.strip() if capture else None

    def service(self, action):
        subprocess.run(['systemctl', action, self.service_name], check=True)

    def prepare(self):
        identity = pwd.getpwnam(self.user)
        for directory in (self.app, self.public):
            if not directory.is_dir() or directory.is_symlink() or directory.resolve() != directory or directory.stat().st_uid != identity.pw_uid:
                raise RuntimeError('Expected the independent production account directories: ' + str(directory))
        revision, archive = artifacts['load_release'](getattr(self, 'revision', None), self.release_store)
        stage = Path(tempfile.mkdtemp(prefix='coasterprint-publish-'))
        self.stage = stage
        os.chown(stage, identity.pw_uid, identity.pw_gid)
        staged_archive = stage / 'release.tar'
        shutil.copyfile(archive, staged_archive)
        os.chown(staged_archive, identity.pw_uid, identity.pw_gid)
        os.chmod(staged_archive, 0o400)
        self.as_user(['tar', '--no-same-owner', '--no-same-permissions', '-xf', staged_archive, '-C', stage])
        staged_archive.unlink()
        return revision, stage

    def validate(self, stage):
        for required in ('server/index.mjs', 'dist/index.html', 'scripts/build-maker.mjs'):
            if not (stage / required).is_file():
                raise RuntimeError('Incomplete release: ' + required)
        if 'process.env.STATIC_ROOT' not in (stage / 'server/index.mjs').read_text():
            raise RuntimeError('This release does not support the production public_html layout.')
        self.as_user([self.node, 'scripts/build-maker.mjs', '--check'], stage)
        tests = sorted(stage.glob('tests/*.test.mjs'))
        if not tests:
            raise RuntimeError('Backend release checks are required.')
        self.as_user([self.node, '--test', *tests], stage)

    def copy_release(self, stage):
        self.as_user(['rsync', '-a', '--safe-links', '--delay-updates', '--exclude=.data/',
                      '--exclude=.env*', '--exclude=.git/', '--exclude=.deployed-commit',
                      str(stage) + '/', str(self.app) + '/'])
        self.as_user(['rsync', '-a', '--safe-links', '--delay-updates', '--exclude=.well-known/',
                      str(stage / 'dist') + '/', str(self.public) + '/'])

    def healthy(self):
        try:
            for address in (f'http://127.0.0.1:{self.port}/health', self.origin + '/health'):
                with urllib.request.urlopen(address, timeout=5) as response:
                    if response.status != 200 or json.load(response).get('ok') is not True:
                        return False
            with urllib.request.urlopen(self.origin + '/', timeout=5) as response:
                page = response.read(200000).decode('utf-8', errors='replace')
                return response.status == 200 and '<main' in page and 'id="maker"' in page and 'id="files"' in page
        except (OSError, ValueError, AttributeError):
            return False

    def wait_healthy(self):
        for _ in range(12):
            if self.healthy():
                return
            time.sleep(1)
        raise RuntimeError('Production health check failed. Inspect journalctl -u coasterprint-node -n 30 --no-pager')

    def write_marker(self, revision):
        self.as_user(['python3', '-c', 'from pathlib import Path; import sys; Path(sys.argv[1]).write_text(sys.argv[2]+"\\n")', self.app / '.deployed-commit', revision])

    def deploy(self):
        try:
            revision, stage = self.prepare()
            marker = self.app / '.deployed-commit'
            if marker.is_file() and marker.read_text().strip() == revision and self.healthy():
                print('Already up to date: ' + revision[:12])
                return
            self.validate(stage)
            self.service('stop')
            try:
                self.copy_release(stage)
            finally:
                self.service('start')
            self.wait_healthy()
            self.write_marker(revision)
            print('Published and healthy: ' + revision[:12])
            print('Production account, public_html, customer data and settings are independent.')
        finally:
            if getattr(self, 'stage', None):
                shutil.rmtree(self.stage)

def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run coasterprint-publish in the server root terminal.')
    parser = argparse.ArgumentParser()
    parser.add_argument('revision', nargs='?')
    parser.add_argument('--archive')
    parser.add_argument('--sha256')
    args = parser.parse_args()
    for command in ('runuser', 'tar', 'rsync', 'systemctl'):
        if not shutil.which(command):
            raise RuntimeError('Required command is missing: ' + command)
    with open('/run/lock/coasterprint-publish.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.archive:
            if not args.revision or not args.sha256:
                raise RuntimeError('Independent archive imports require a revision and SHA-256.')
            artifacts['stage_release'](Path(args.archive), args.revision, expected_digest=args.sha256)
        updater = ProductionUpdater()
        updater.revision = args.revision
        updater.deploy()

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print('Publish failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
