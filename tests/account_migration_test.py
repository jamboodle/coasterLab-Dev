import importlib.util
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('account_migration',Path(__file__).parents[1]/'scripts/migrate-production-account.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class FixtureMigration(module.Migration):
    def __init__(self,root,fail=False):
        self.home=root/'coasterprint';self.home.mkdir()
        self.old=root/'old-account'/'coasterprint';self.old.mkdir(parents=True)
        self.app=self.home/'app';self.public=self.home/'public_html';self.public.mkdir()
        (self.public/'index.html').write_text('Webuzo default')
        self.unit=root/'production.service';self.proxy=root/'production.conf'
        self.rollback_root=root/'root-only-migration'
        self.unit.write_text('[Unit]\nDescription=Production\n[Service]\nUser=jamboodle\nWorkingDirectory='+str(self.old)+'\nEnvironment=NODE_ENV=production\nExecStart=/node server/index.mjs\n[Install]\nWantedBy=multi-user.target\n')
        self.proxy.write_text('location @app { proxy_pass http://127.0.0.1:30002; }\n')
        (self.old/'server').mkdir();(self.old/'scripts').mkdir();(self.old/'dist').mkdir();(self.old/'.data').mkdir()
        (self.old/'server/index.mjs').write_text("const root=fileURLToPath(new URL('../dist/',import.meta.url));")
        (self.old/'dist/index.html').write_text('<main id="maker"><input id="files">production</main>')
        (self.old/'.env').write_text('private mail settings')
        with sqlite3.connect(self.old/'.data/credits.sqlite') as db:
            db.execute('CREATE TABLE settings(key TEXT,value TEXT)');db.execute('INSERT INTO settings VALUES (?,?)',('liveSecretKey','private-live-key'))
            db.execute('CREATE TABLE entries(account TEXT,delta INTEGER)');db.execute('INSERT INTO entries VALUES (?,?)',('customer',137))
        self.fail=fail;self.events=[];self.original_unit=self.unit.read_text();self.original_proxy=self.proxy.read_text()
        self.identity=SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid(),pw_dir=str(self.home))
        self.old_environment={'APP_ORIGIN':'https://coasterprint.com','PORT':'30002','ALLOW_LIVE_PAYMENTS':'1'}

    def preflight(self):
        if self.app.exists():raise RuntimeError('New app already exists')

    def run(self,args,capture=False):
        self.events.append(list(map(str,args)))
        if 'PRAGMA quick_check' in ' '.join(map(str,args)):return 'ok'
        return '' if capture else None

    def property(self,name):return '0' if name=='MainPID' else ''

    def rsync(self,source,destination,private=False):
        destination.mkdir(parents=True,exist_ok=True)
        for path in source.iterdir():
            if private and path.name in ('.data','.git'):continue
            if path.is_dir():shutil.copytree(path,destination/path.name,dirs_exist_ok=True)
            else:shutil.copy2(path,destination/path.name)

    def local_health(self):
        self.assert_new()
        if self.fail=='health':raise RuntimeError('Candidate failed health')

    def assert_new(self):
        assert 'User=coasterprint' in self.unit.read_text()
        assert str(self.public) in self.unit.read_text()
        assert 'process.env.STATIC_ROOT' in (self.app/'server/index.mjs').read_text()
        assert (self.public/'index.html').read_text().endswith('production</main>')
        with sqlite3.connect(self.app/'.data/credits.sqlite') as db:
            assert db.execute('SELECT SUM(delta) FROM entries').fetchone()[0]==137
            assert db.execute("SELECT value FROM settings WHERE key='liveSecretKey'").fetchone()[0]=='private-live-key'

    def install_tools(self):
        if self.fail=='tools':raise RuntimeError('Tool installation failed')

class MigrationTests(unittest.TestCase):
    def test_real_preflight_refuses_existing_content_and_old_account_overrides(self):
        for case in ('content','symlink','dropin','environment_file'):
            with self.subTest(case=case),tempfile.TemporaryDirectory() as temporary:
                migration=FixtureMigration(Path(temporary))
                properties={'User':'jamboodle','WorkingDirectory':str(migration.old),'FragmentPath':str(migration.unit),'DropInPaths':'','EnvironmentFiles':''}
                if case=='content':
                    (migration.public/'customer-file.txt').write_text('keep this')
                elif case=='symlink':
                    (migration.public/'index.html').unlink()
                    (migration.public/'index.html').symlink_to(migration.old/'dist/index.html')
                elif case=='dropin':
                    override=Path(temporary)/'override.conf';override.write_text('[Service]\nUser=jamboodle\n')
                    properties['DropInPaths']=str(override)
                else:
                    properties['EnvironmentFiles']='/home/jamboodle/private.env'
                migration.property=lambda key:properties[key]
                migration.process_environment=lambda:migration.old_environment
                with patch.object(module.pwd,'getpwnam',return_value=migration.identity):
                    with self.assertRaises(RuntimeError):module.Migration.preflight(migration)
                self.assertFalse(migration.app.exists())
                self.assertEqual(migration.unit.read_text(),migration.original_unit)
                self.assertEqual(migration.events,[])

    def test_move_preserves_live_data_and_moves_old_copy_out_of_original_account(self):
        with tempfile.TemporaryDirectory() as temporary:
            migration=FixtureMigration(Path(temporary))
            with patch.object(module.os,'chown'):
                migration.apply()
            migration.assert_new();self.assertFalse(migration.old.exists())
            old=list(migration.rollback_root.glob('*/legacy-app/.data/credits.sqlite'))
            self.assertEqual(len(old),1)
            self.assertEqual(migration.proxy.read_text(),migration.original_proxy)
            self.assertEqual((migration.app/'.env').read_text(),'private mail settings')
            self.assertTrue(any(command[:3]==['chown','-R','root:root'] for command in migration.events))

    def test_failed_health_or_tool_install_restores_previous_service_and_customer_data(self):
        for failure in ('health','tools'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as temporary:
                migration=FixtureMigration(Path(temporary),failure)
                with patch.object(module.os,'chown'),patch.object(module.pwd,'getpwnam',return_value=migration.identity):
                    with self.assertRaises(RuntimeError):migration.apply()
                self.assertEqual(migration.unit.read_text(),migration.original_unit)
                self.assertEqual(migration.proxy.read_text(),migration.original_proxy)
                self.assertEqual((migration.public/'index.html').read_text(),'Webuzo default')
                with sqlite3.connect(migration.old/'.data/credits.sqlite') as db:
                    self.assertEqual(db.execute('SELECT SUM(delta) FROM entries').fetchone()[0],137)
                    self.assertEqual(db.execute('SELECT value FROM settings').fetchone()[0],'private-live-key')

    def test_unit_rewrite_preserves_environment_and_dropin_compatibility(self):
        original='[Unit]\nDescription=App\n[Service]\nUser=old\nWorkingDirectory=/old\nEnvironment=ALLOW_LIVE_PAYMENTS=1\nExecStart=/node old.mjs\nUMask=0077\n[Install]\nWantedBy=multi-user.target\n'
        result=module.Migration.relocated_unit(original,'coasterprint','coasterprint',Path('/home/coasterprint/app'),Path('/home/coasterprint/public_html'),'/node')
        self.assertIn('Environment=ALLOW_LIVE_PAYMENTS=1',result)
        self.assertIn('UMask=0077',result)
        self.assertIn('Group=coasterprint',result)
        self.assertIn('Environment=DATABASE_PATH=/home/coasterprint/app/.data/credits.sqlite',result)
        self.assertNotIn('/old',result)

if __name__=='__main__':unittest.main()
