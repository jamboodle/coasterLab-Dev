#!/usr/bin/env python3
"""One-time production-account relocation, with maintenance and root-only rollback."""
import argparse
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys
import time
import tempfile
import urllib.request

class Migration:
    old_user = 'jamboodle'
    user = 'coasterprint'
    old = Path('/home/jamboodle/coasterprint')
    home = Path('/home/coasterprint')
    app = home / 'app'
    public = home / 'public_html'
    unit = Path('/etc/systemd/system/coasterprint-node.service')
    proxy = Path('/var/webuzo-data/nginx/custom/domains/coasterprint.com.conf')
    rollback_root = Path('/var/lib/coasterprint/migration')
    service = 'coasterprint-node'
    node = '/usr/local/apps/nodejs24/bin/node'
    nginx = '/usr/local/apps/nginx/sbin/nginx'

    def run(self, args, capture=False):
        result = subprocess.run(list(map(str,args)), check=True, text=True,
                                stdout=subprocess.PIPE if capture else None)
        return result.stdout.strip() if capture else None

    def property(self, name):
        return self.run(['systemctl', 'show', self.service, '-p', name, '--value'], True)

    def process_environment(self):
        pid = self.property('MainPID')
        if not pid.isdigit() or int(pid) <= 0:
            raise RuntimeError('Production service must be running for preflight.')
        values = Path('/proc/' + pid + '/environ').read_bytes().split(b'\0')
        return dict(value.decode().split('=',1) for value in values if b'=' in value)

    def preflight(self):
        identity = pwd.getpwnam(self.user)
        if Path(identity.pw_dir) != self.home or not self.home.is_dir() or self.home.is_symlink():
            raise RuntimeError('Expected the existing coasterprint hosting account and home directory.')
        if self.property('User') != self.old_user or self.property('WorkingDirectory') != str(self.old):
            raise RuntimeError('Production service layout differs from the expected old layout. Nothing changed.')
        if self.property('FragmentPath') != str(self.unit):
            raise RuntimeError('Unexpected production unit file. Nothing changed.')
        for path in (self.old, self.old / '.data', self.old / '.data/credits.sqlite', self.unit, self.proxy, self.public):
            if not path.exists() or path.is_symlink():
                raise RuntimeError('Expected an existing regular production path: ' + str(path))
        if self.app.exists() or self.app.is_symlink():
            raise RuntimeError('The new app directory already exists. Refusing to overwrite it.')
        # public_html must contain only hosting defaults/acme files before relocation.
        for path in self.public.iterdir():
            if path.name == '.well-known' and path.is_dir() and not path.is_symlink():
                continue
            if path.name == 'index.html' and path.is_file() and not path.is_symlink() and 'webuzo' in path.read_text(errors='replace').lower():
                continue
            if path.name == '.htaccess' and path.is_file() and not path.is_symlink():
                continue
            raise RuntimeError('public_html has existing content requiring review: ' + path.name)
        environment = self.process_environment()
        if environment.get('APP_ORIGIN') != 'https://coasterprint.com' or environment.get('PORT') != '30002':
            raise RuntimeError('Unexpected production origin or port. Nothing changed.')
        database = Path(environment.get('DATABASE_PATH', str(self.old / '.data/credits.sqlite')))
        if not database.is_absolute():
            database = self.old / database
        if database.resolve() != (self.old / '.data/credits.sqlite').resolve():
            raise RuntimeError('Production uses a custom database location; review it before relocating.')
        for key,value in environment.items():
            if '/home/jamboodle' in value and key not in ('HOME','PWD','USER','LOGNAME','DATABASE_PATH','STATIC_ROOT'):
                raise RuntimeError('A service setting still references the other account: ' + key)
        prospective = self.relocated_unit(self.unit.read_text(),self.user,grp.getgrgid(identity.pw_gid).gr_name,self.app,self.public,self.node)
        if '/home/jamboodle' in prospective:
            raise RuntimeError('Additional unit settings still refer to the old account. Review them before moving.')
        for name in self.property('DropInPaths').split():
            content = Path(name).read_text()
            if '/home/jamboodle' in content or re.search(r'(?m)^(User|Group|WorkingDirectory|ExecStart)=',content):
                raise RuntimeError('A service drop-in has account-specific overrides requiring review: ' + name)
        if '/home/jamboodle' in self.property('EnvironmentFiles'):
            raise RuntimeError('A service environment file is stored under the old account.')
        self.run(['runuser','-u',self.user,'--',self.node,'--version'])
        for program in ('rsync','systemctl','runuser'):
            if not shutil.which(program):
                raise RuntimeError('Required server command is missing: ' + program)
        self.run([self.nginx,'-t'])
        self.identity = identity
        self.old_environment = environment
        print('Preflight passed: account coasterprint, private app /home/coasterprint/app, website /home/coasterprint/public_html.', flush=True)

    @staticmethod
    def relocated_unit(original, user, group, app, public, node):
        match = re.search(r'(?ms)^\[Service\]\n(.*?)(?=^\[|\Z)', original)
        if not match:
            raise RuntimeError('Production unit has no Service section.')
        section = match.group(1)
        for key,value in [('User',user),('Group',group),('WorkingDirectory',str(app)),('ExecStart',node+' --title=coasterprint server/index.mjs')]:
            expression = r'(?m)^' + key + r'=.*$'
            if len(re.findall(expression,section)) > 1 or '\\\n' in section:
                raise RuntimeError('Complex service overrides require manual review.')
            if re.search(expression,section):
                section = re.sub(expression,lambda _match:key+'='+value,section)
            else:
                section += '\n'+key+'='+value+'\n'
        section += '\nEnvironment=STATIC_ROOT='+str(public)+'\nEnvironment=DATABASE_PATH='+str(app / '.data/credits.sqlite')+'\n'
        return original[:match.start(1)] + section + original[match.end(1):]

    def rsync(self, source, destination, private=False):
        command = ['rsync','-a','--safe-links','--chown='+self.user+':'+grp.getgrgid(self.identity.pw_gid).gr_name]
        if private:
            command += ['--exclude=.data/','--exclude=.git/']
        command += [str(source)+'/', str(destination)+'/']
        self.run(command)

    def local_health(self):
        for _ in range(15):
            try:
                with urllib.request.urlopen('http://127.0.0.1:30002/health',timeout=5) as response:
                    if json.load(response).get('ok') is not True:
                        raise RuntimeError('Unexpected health response.')
                with urllib.request.urlopen('http://127.0.0.1:30002/',timeout=5) as response:
                    html = response.read(200000).decode(errors='replace')
                    if '<main' not in html or 'id="maker"' not in html or 'id="files"' not in html:
                        raise RuntimeError('Production homepage was not served from the new public root.')
                if self.property('User') != self.user or self.property('WorkingDirectory') != str(self.app):
                    raise RuntimeError('Service did not switch to the independent account.')
                current = self.process_environment()
                if current.get('STATIC_ROOT') != str(self.public) or current.get('DATABASE_PATH') != str(self.app / '.data/credits.sqlite'):
                    raise RuntimeError('Production runtime paths did not switch.')
                if any('/home/jamboodle' in value for value in current.values()):
                    raise RuntimeError('New service environment still refers to the old account.')
                required = set(('APP_ORIGIN','NODE_ENV','ALLOW_LIVE_PAYMENTS'))|{key for key in self.old_environment if key.startswith(('STRIPE_','EMAIL_','ENABLE_','SENDMAIL_'))}
                for key in required:
                    if current.get(key) != self.old_environment.get(key):
                        raise RuntimeError('A production setting changed unexpectedly: ' + key)
                return
            except OSError:
                time.sleep(1)
        raise RuntimeError('New production service did not become healthy.')

    def install_tools(self):
        scripts = Path(__file__).resolve().parent
        library = Path('/usr/local/lib/coasterprint')
        if library.is_symlink():
            raise RuntimeError('Production tool library must not be a symlink.')
        library.mkdir(parents=True,exist_ok=True,mode=0o755)
        if library.stat().st_uid!=os.geteuid() or library.stat().st_mode & 0o022:
            raise RuntimeError('Production tool library must be root-owned and not writable by other users.')
        destinations = [(scripts/'release_artifacts.py',library/'release_artifacts.py',0o644),
                        (scripts/'coasterprint-publish.py',Path('/usr/local/sbin/coasterprint-publish'),0o755),
                        (scripts/'coasterlab-update.py',Path('/usr/local/sbin/coasterlab-update'),0o755)]
        self.tool_originals = []
        for source,target,mode in destinations:
            if target.is_symlink():
                raise RuntimeError('Installed helper must not be a symlink: ' + str(target))
            self.tool_originals.append((target,target.read_bytes() if target.exists() else None,target.stat().st_mode & 0o777 if target.exists() else None))
        for source,target,mode in destinations:
            if not source.is_file() or source.is_symlink():
                raise RuntimeError('Migration companion tool is missing: ' + source.name)
            descriptor,name = tempfile.mkstemp(prefix='.install-',dir=target.parent)
            try:
                with os.fdopen(descriptor,'wb') as output:
                    output.write(source.read_bytes())
                os.chown(name,0,0)
                os.chmod(name,mode)
                os.replace(name,target)
            finally:
                Path(name).unlink(missing_ok=True)
        for name in ('release_artifacts.py','coasterprint-publish.py'):
            target=self.app/'scripts'/name
            shutil.copyfile(scripts/name,target)
            os.chown(target,self.identity.pw_uid,self.identity.pw_gid)
            os.chmod(target,0o644)

    def apply(self):
        self.preflight()
        if self.rollback_root.is_symlink():
            raise RuntimeError('Rollback location must not be a symlink.')
        self.rollback_root.mkdir(parents=True,exist_ok=True,mode=0o700)
        if self.rollback_root.stat().st_uid!=os.geteuid():
            raise RuntimeError('Rollback location must be root-owned.')
        os.chmod(self.rollback_root,0o700)
        rollback = self.rollback_root / time.strftime('%Y%m%d-%H%M%S')
        rollback.mkdir(mode=0o700)
        original_unit,original_proxy = self.unit.read_text(),self.proxy.read_text()
        (rollback/'service.original').write_text(original_unit)
        (rollback/'proxy.original').write_text(original_proxy)
        # Preserve only hosting defaults; private customer data is copied after stop.
        shutil.copytree(self.public,rollback/'public.original',symlinks=True)
        self.app.mkdir(mode=0o750)
        os.chown(self.app,self.identity.pw_uid,self.identity.pw_gid)
        stopped = False
        archived = False
        reopened = False
        try:
            self.rsync(self.old,self.app,private=True)
            self.rsync(self.old/'dist',self.public)
            entry = self.app/'server/index.mjs'
            code = entry.read_text()
            if 'process.env.STATIC_ROOT' not in code:
                needle = "fileURLToPath(new URL('../dist/',import.meta.url))"
                if code.count(needle) != 1:
                    raise RuntimeError('Unexpected server entry point; static-root patch cannot be applied safely.')
                entry.write_text(code.replace(needle,'process.env.STATIC_ROOT || '+needle))
            self.run(['runuser','-u',self.user,'--',self.node,'--check',entry])
            self.proxy.write_text('return 503; # Brief CoasterPrint account relocation\n'+original_proxy)
            try:
                self.run([self.nginx,'-t'])
                self.run([self.nginx,'-s','reload'])
            except BaseException:
                self.proxy.write_text(original_proxy)
                raise
            self.run(['systemctl','stop',self.service])
            stopped = True
            if self.property('MainPID') != '0':
                raise RuntimeError('Old production process is still active.')
            self.rsync(self.old/'.data',self.app/'.data')
            os.chmod(self.app/'.data',0o700)
            for name in ('credits.sqlite','credits.sqlite-wal'):
                source = self.old/'.data'/name
                if source.exists():
                    with open(source,'rb') as original,open(self.app/'.data'/name,'rb') as copied:
                        if hashlib.file_digest(original,'sha256').digest() != hashlib.file_digest(copied,'sha256').digest():
                            raise RuntimeError('Database copy does not match the stopped production database.')
            check = self.run(['runuser','-u',self.user,'--','python3','-c',
                             'import sqlite3,sys; db=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); print(db.execute("PRAGMA quick_check").fetchone()[0]); db.close()',
                             self.app/'.data/credits.sqlite'],True)
            if check != 'ok':
                raise RuntimeError('Customer database copy did not pass verification.')
            self.unit.write_text(self.relocated_unit(original_unit,self.user,grp.getgrgid(self.identity.pw_gid).gr_name,self.app,self.public,self.node))
            self.run(['systemctl','daemon-reload'])
            self.run(['systemctl','start',self.service])
            self.local_health()
            # Remove the previous account's access to all old production data.
            self.run(['chown','-R','root:root',self.old])
            os.chmod(self.old,0o700)
            shutil.move(str(self.old),str(rollback/'legacy-app'))
            archived = True
            self.install_tools()
            self.proxy.write_text(original_proxy)
            self.run([self.nginx,'-t'])
            self.run([self.nginx,'-s','reload'])
            reopened = True
            print('Production moved successfully to the coasterprint account.',flush=True)
            print('Public files: '+str(self.public))
            print('Private app/customer data: '+str(self.app))
            print('Old account has no production folder. Root-only rollback copy: '+str(rollback))
        except BaseException:
            if not reopened:
                for target,content,mode in getattr(self,'tool_originals',[]):
                    if content is None:
                        target.unlink(missing_ok=True)
                    else:
                        target.write_bytes(content)
                        os.chmod(target,mode)
                if stopped:
                    self.run(['systemctl','stop',self.service])
                if archived:
                    shutil.move(str(rollback/'legacy-app'),str(self.old))
                if stopped:
                    previous = pwd.getpwnam(self.old_user)
                    self.run(['chown','-R',str(previous.pw_uid)+':'+str(previous.pw_gid),self.old])
                    os.chmod(self.old,0o750)
                self.unit.write_text(original_unit)
                self.proxy.write_text(original_proxy)
                self.run(['systemctl','daemon-reload'])
                if stopped:
                    self.run(['systemctl','start',self.service])
                # The new process was never exposed to customers before rollback.
                shutil.rmtree(self.public)
                shutil.copytree(rollback/'public.original',self.public,symlinks=True)
                self.run(['chown','-R',self.user+':'+grp.getgrgid(self.identity.pw_gid).gr_name,self.public])
                self.run([self.nginx,'-t'])
                self.run([self.nginx,'-s','reload'])
                print('Migration failed; restored the previous production service. New files remain for diagnosis.',file=sys.stderr)
            raise

def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run this in the server root terminal.')
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply',action='store_true',help='Perform the move; without this option only preflight runs.')
    args = parser.parse_args()
    with open('/run/lock/coasterlab-update.lock','w') as development_lock, open('/run/lock/coasterprint-publish.lock','w') as production_lock:
        for lock in (development_lock,production_lock):
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        migration = Migration()
        if args.apply:
            migration.apply()
        else:
            migration.preflight()

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError,OSError,KeyError,ValueError,subprocess.CalledProcessError) as error:
        print('Account migration failed: '+str(error),file=sys.stderr)
        sys.exit(1)
