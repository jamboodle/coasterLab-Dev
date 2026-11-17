#!/usr/bin/env python3
"""Root entry point for this server. App/Git/test/file-copy commands run as jamboodle."""
import fcntl
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request


class Updater:
    user = 'jamboodle'
    app = Path('/home/jamboodle/coasterlab-dev')
    source = Path('/home/jamboodle/coasterlab-source')
    node = '/usr/local/apps/nodejs24/bin/node'
    service_name = 'coasterlab-dev-node'
    repository = 'git@github.com:jamboodle/coasterLab-Dev.git'
    origin = 'https://dev.jamboodle.com'
    port = 30001

    def as_user(self, args, cwd=None, capture=False):
        environment = dict(os.environ)
        environment['PYTHONDONTWRITEBYTECODE'] = '1'
        environment['GIT_TERMINAL_PROMPT'] = '0'
        environment['GIT_SSH_COMMAND'] = (
            'ssh -i /home/jamboodle/.ssh/coasterlab_deploy '
            '-o IdentitiesOnly=yes -o StrictHostKeyChecking=yes '
            '-o UserKnownHostsFile=/home/jamboodle/.ssh/coasterlab_known_hosts'
        )
        result = subprocess.run(
            ['runuser', '-u', self.user, '--', *map(str, args)],
            cwd=cwd, env=environment, check=True,
            text=True, stdout=subprocess.PIPE if capture else None,
        )
        return result.stdout.strip() if capture else None

    def service(self, action):
        subprocess.run(['systemctl', action, self.service_name], check=True)

    def prepare(self):
        if not self.app.is_dir() or self.app.is_symlink():
            raise RuntimeError('Expected the existing app directory, not a symlink.')
        if not (self.source / '.git').is_dir() or self.source.is_symlink():
            raise RuntimeError('Set up /home/jamboodle/coasterlab-source first; see DEPLOYMENT.md.')
        remote = self.as_user(['git', 'remote', 'get-url', 'origin'], self.source, True)
        if remote.lower() != self.repository.lower():
            raise RuntimeError('Deployment checkout has an unexpected origin; nothing changed.')
        if self.as_user(['git', 'status', '--porcelain'], self.source, True):
            raise RuntimeError('Deployment checkout has local changes. Preserve them before updating.')
        if self.as_user(['git', 'branch', '--show-current'], self.source, True) != 'main':
            raise RuntimeError('Deployment checkout must be on main.')
        self.as_user(['git', 'fetch', 'origin', 'main'], self.source)
        if self.as_user(['git', 'rev-list', '--count', 'origin/main..HEAD'], self.source, True) != '0':
            raise RuntimeError('Deployment checkout has local commits; refusing to replace them.')
        self.as_user(['git', 'merge', '--ff-only', 'origin/main'], self.source)
        revision = self.as_user(['git', 'rev-parse', 'HEAD'], self.source, True)
        stage = Path(tempfile.mkdtemp(prefix='coasterlab-update-'))
        self.stage = stage
        identity = pwd.getpwnam(self.user)
        os.chown(stage, identity.pw_uid, identity.pw_gid)
        archive = stage / 'release.tar'
        self.as_user(['git', 'archive', '--format=tar', '--output', archive, revision], self.source)
        self.as_user(['tar', '-xf', archive, '-C', stage])
        archive.unlink()
        return revision, stage

    def validate(self, stage):
        for required in ['server/index.mjs', 'dist/index.html', 'scripts/build-maker.mjs']:
            if not (stage / required).is_file():
                raise RuntimeError('Incomplete release: ' + required)
        self.as_user([self.node, 'scripts/build-maker.mjs', '--check'], stage)
        tests = sorted(stage.glob('tests/*.test.mjs'))
        if not tests:
            raise RuntimeError('No backend tests found; refusing to deploy an unchecked release.')
        self.as_user([self.node, '--test', *tests], stage)

    def copy_release(self, stage):
        self.as_user([
            'rsync', '-a', '--safe-links', '--delay-updates',
            '--exclude=.data/', '--exclude=.env*', '--exclude=.git/',
            '--exclude=.deployed-commit', str(stage) + '/', str(self.app) + '/',
        ])

    def healthy(self):
        try:
            for address in [f'http://127.0.0.1:{self.port}/health', self.origin + '/health']:
                with urllib.request.urlopen(address, timeout=5) as response:
                    data = json.load(response)
                    if response.status != 200 or not isinstance(data, dict) or data.get('ok') is not True:
                        return False
            with urllib.request.urlopen(self.origin + '/', timeout=5) as response:
                page = response.read(200000).decode('utf-8', errors='replace')
                return response.status == 200 and '<main' in page and 'id="maker"' in page and 'id="files"' in page
        except (OSError, ValueError):
            return False

    def wait_healthy(self):
        for _ in range(12):
            if self.healthy():
                return
            time.sleep(1)
        raise RuntimeError(f'Health check failed. Inspect: journalctl -u {self.service_name} -n 30 --no-pager')

    def write_marker(self, revision):
        self.as_user(['python3', '-c',
            'from pathlib import Path; import sys; Path(sys.argv[1]).write_text(sys.argv[2]+"\\n")',
            self.app / '.deployed-commit', revision])

    def deploy(self):
        try:
            revision, stage = self.prepare()
            marker = self.app / '.deployed-commit'
            if marker.exists() and marker.read_text().strip() == revision and self.healthy():
                print('Already up to date: ' + revision[:12])
                return
            self.validate(stage)
            # No database migration or service interruption until release checks pass.
            self.service('stop')
            try:
                self.copy_release(stage)
            finally:
                self.service('start')
            self.wait_healthy()
            self.write_marker(revision)
            print('Updated and healthy: ' + revision[:12])
            print('Accounts, balances, environment files and service settings preserved.')
        finally:
            if getattr(self, 'stage', None):
                shutil.rmtree(self.stage)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run coasterlab-update in the server root terminal.')
    for program in ['runuser', 'git', 'rsync', 'tar', 'systemctl']:
        if not shutil.which(program):
            raise RuntimeError('Required server tool is missing: ' + program)
    updater = Updater()
    if not Path(updater.node).is_file():
        raise RuntimeError('Webuzo Node.js 24 binary not found.')
    with open('/run/lock/coasterlab-update.lock', 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another CoasterPrint update is already running.') from None
        updater.deploy()


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError) as error:
        print('Update failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
