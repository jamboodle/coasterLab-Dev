import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import io

spec = importlib.util.spec_from_file_location('production_updater', Path(__file__).parents[1] / 'scripts/coasterprint-publish.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProductionTests(unittest.TestCase):
    def test_promotes_marker_even_when_checkout_has_newer_commit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            updater = module.ProductionUpdater()
            updater.app = root / 'production'
            updater.development = root / 'development'
            updater.source = root / 'source'
            for path in [updater.app, updater.development, updater.source]:
                path.mkdir()
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=updater.source, text=True).strip()
            git('init', '-q')
            (updater.source / 'release.txt').write_text('tested release')
            git('add', '.')
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'tested')
            tested = git('rev-parse', 'HEAD')
            (updater.development / '.deployed-commit').write_text(tested)
            (updater.source / 'release.txt').write_text('untested release')
            git('add', '.')
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'untested')
            calls = []
            def as_user(args, cwd=None, capture=False):
                calls.append(list(map(str, args)))
                result = subprocess.run(list(map(str, args)), cwd=cwd, check=True, text=True, capture_output=True)
                return result.stdout.strip() if capture else None
            updater.as_user = as_user
            with patch.object(module.os, 'chown'), patch.object(module.pwd, 'getpwnam') as identity, patch.object(module.BaseUpdater, 'healthy', return_value=True):
                identity.return_value.pw_uid = 1000
                identity.return_value.pw_gid = 1000
                revision, stage = updater.prepare()
            try:
                self.assertEqual(revision, tested)
                self.assertEqual((stage / 'release.txt').read_text(), 'tested release')
                self.assertFalse(any('fetch' in call or 'merge' in call for call in calls))
            finally:
                shutil.rmtree(stage)
            (updater.development / '.deployed-commit').write_text('invalid')
            with self.assertRaisesRegex(RuntimeError, 'Invalid development'):
                updater.prepare()
            (updater.development / '.deployed-commit').write_text(tested)
            with patch.object(module.BaseUpdater, 'healthy', return_value=False):
                with self.assertRaisesRegex(RuntimeError, 'Development health'):
                    updater.prepare()

    def test_production_health_uses_only_production_addresses(self):
        class Response(io.BytesIO):
            status = 200
        addresses = []
        def response(address, **kwargs):
            addresses.append(address)
            return Response(b'{"ok":true}' if address.endswith('/health') else b'<main id="maker"><input id="files">')
        # Inherited method uses the base module globals.
        with patch('urllib.request.urlopen', side_effect=response):
            self.assertTrue(module.ProductionUpdater().healthy())
        self.assertEqual(addresses, ['http://127.0.0.1:30002/health', 'https://coasterprint.com/health', 'https://coasterprint.com/'])

    def test_production_reuses_data_preserving_copy_and_validation(self):
        self.assertIs(module.ProductionUpdater.copy_release, module.BaseUpdater.copy_release)
        self.assertIs(module.ProductionUpdater.validate, module.BaseUpdater.validate)
        self.assertNotEqual(module.ProductionUpdater.app, module.BaseUpdater.app)
        self.assertNotEqual(module.ProductionUpdater.service_name, module.BaseUpdater.service_name)


if __name__ == '__main__':
    unittest.main()
