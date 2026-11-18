import importlib.util
import io
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('production_updater', Path(__file__).parents[1] / 'scripts/coasterprint-publish.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ProductionTests(unittest.TestCase):
    def test_promotes_packaged_commit_without_any_development_folder(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            updater = module.ProductionUpdater()
            updater.home = root / 'coasterprint'
            updater.app = updater.home / 'app'
            updater.public = updater.home / 'public_html'
            updater.release_store = root / 'releases'
            updater.app.mkdir(parents=True)
            updater.public.mkdir()
            incoming = root / 'incoming.tar'
            with tarfile.open(incoming,'w') as archive:
                data = b'tested release'
                info = tarfile.TarInfo('release.txt')
                info.size = len(data)
                archive.addfile(info,io.BytesIO(data))
            module.artifacts['stage_release'](incoming,'a'*40,updater.release_store)
            incoming.unlink()
            calls=[]
            def execute(args,cwd=None,capture=False):
                calls.append(list(map(str,args)))
                subprocess.run(list(map(str,args)),cwd=cwd,check=True,capture_output=True)
            updater.as_user=execute
            identity=SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid())
            with patch.object(module.pwd,'getpwnam',return_value=identity):
                revision,stage=updater.prepare()
            try:
                self.assertEqual(revision,'a'*40)
                self.assertEqual((stage/'release.txt').read_text(),'tested release')
                self.assertFalse(any('git' in command for command in calls))
                self.assertFalse(hasattr(updater,'development'))
            finally:
                shutil.rmtree(stage)
            (updater.release_store/('a'*40+'.tar')).write_bytes(b'corrupt')
            with patch.object(module.pwd,'getpwnam',return_value=identity):
                with self.assertRaisesRegex(RuntimeError,'integrity'):
                    updater.prepare()

    def test_production_health_uses_only_production_addresses(self):
        class Response(io.BytesIO):
            status=200
        addresses=[]
        def response(address,**kwargs):
            addresses.append(address)
            return Response(b'{"ok":true}' if address.endswith('/health') else b'<main id="maker"><input id="files">')
        with patch.object(module.urllib.request,'urlopen',side_effect=response):
            self.assertTrue(module.ProductionUpdater().healthy())
        self.assertEqual(addresses,['http://127.0.0.1:30002/health','https://coasterprint.com/health','https://coasterprint.com/'])

    def test_copy_updates_private_code_and_public_html_without_overwriting_customer_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            updater=module.ProductionUpdater()
            updater.app=root/'app';updater.public=root/'public_html'
            updater.app.mkdir();updater.public.mkdir()
            (updater.app/'.data').mkdir();(updater.app/'.data/credits.sqlite').write_text('live customers')
            (updater.app/'.env').write_text('private settings')
            (updater.public/'.well-known').mkdir();(updater.public/'.well-known/token').write_text('certificate token')
            stage=root/'stage';stage.mkdir();(stage/'dist').mkdir();(stage/'server').mkdir();(stage/'.data').mkdir()
            (stage/'.data/credits.sqlite').write_text('must not copy');(stage/'.env').write_text('must not copy')
            (stage/'server/index.mjs').write_text('new server');(stage/'dist/index.html').write_text('new website')
            commands=[]
            def copy(args,**kwargs):
                commands.append(args)
                source,destination=Path(args[-2]),Path(args[-1])
                self.assertNotIn('--delete',args)
                for path in source.iterdir():
                    if path.name in ('.data','.git','.deployed-commit','.well-known') or path.name.startswith('.env'):
                        continue
                    if path.is_dir():shutil.copytree(path,destination/path.name,dirs_exist_ok=True)
                    else:shutil.copy2(path,destination/path.name)
            updater.as_user=copy
            updater.copy_release(stage)
            self.assertEqual((updater.app/'.data/credits.sqlite').read_text(),'live customers')
            self.assertEqual((updater.app/'.env').read_text(),'private settings')
            self.assertEqual((updater.public/'index.html').read_text(),'new website')
            self.assertEqual((updater.public/'.well-known/token').read_text(),'certificate token')
            self.assertEqual(len(commands),2)

    def test_production_commands_run_as_its_own_account_without_root_secrets(self):
        result=SimpleNamespace(stdout='')
        with patch.dict(os.environ,{'STRIPE_SECRET_KEY':'never-inherit'}),patch.object(module.subprocess,'run',return_value=result) as run:
            module.ProductionUpdater().as_user(['node','--version'])
        args,options=run.call_args
        self.assertEqual(args[0][:3],['runuser','-u','coasterprint'])
        self.assertEqual(options['env']['HOME'],'/home/coasterprint')
        self.assertNotIn('STRIPE_SECRET_KEY',options['env'])

if __name__=='__main__':
    unittest.main()
