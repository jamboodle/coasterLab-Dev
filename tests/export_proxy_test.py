import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('export_proxy', Path(__file__).parents[1] / 'scripts/configure-export-proxy.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ProxyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'domain.conf'
        self.original = 'error_page 418 = @app;\nlocation @app { proxy_pass http://127.0.0.1:30001; }\n'
        self.path.write_text(self.original)
    def tearDown(self):
        self.temp.cleanup()
    def execute(self, command):
        with patch.object(module.os, 'geteuid', return_value=0), patch.object(module, 'Path', return_value=self.path), patch.object(module.sys, 'argv', ['configure-export-proxy.py', 'development']), patch.object(module.subprocess, 'run', side_effect=command) as run:
            module.main()
            return run.call_count
    def test_adds_bounds_preserves_routing_and_is_idempotent(self):
        self.assertEqual(self.execute(lambda *_args, **_kwargs: None), 2)
        content = self.path.read_text()
        self.assertIn('client_max_body_size 32m;', content)
        self.assertIn('proxy_read_timeout 90s;', content)
        self.assertTrue(content.endswith(self.original))
        self.assertEqual(self.execute(lambda *_args, **_kwargs: None), 0)
        self.assertEqual(self.path.read_text(), content)
    def test_failed_validation_restores_original(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.execute(lambda *_args, **_kwargs: (_ for _ in ()).throw(subprocess.CalledProcessError(1, 'nginx')))
        self.assertEqual(self.path.read_text(), self.original)
    def test_existing_custom_bounds_are_not_overwritten(self):
        self.path.write_text('client_max_body_size 20m;\n' + self.original)
        before = self.path.read_text()
        with self.assertRaisesRegex(RuntimeError, 'already exist'):
            self.execute(lambda *_args, **_kwargs: None)
        self.assertEqual(self.path.read_text(), before)

if __name__ == '__main__':
    unittest.main()
