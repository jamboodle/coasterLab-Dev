import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('coasterlab_updater', Path(__file__).parents[1] / 'scripts/coasterlab-update.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FixtureUpdater(module.Updater):
    def __init__(self, root, fail=None):
        self.app = root / 'app'
        self.app.mkdir()
        self.stage = root / 'stage'
        self.stage.mkdir()
        self.revision = 'f' * 40
        self.events = []
        self.fail = fail

    def prepare(self):
        self.events.append('prepare')
        return self.revision, self.stage

    def validate(self, stage):
        self.events.append('validate')
        if self.fail == 'validate':
            raise RuntimeError('Invalid release')

    def service(self, action):
        self.events.append(action)

    def copy_release(self, stage):
        self.events.append('copy')
        if self.fail == 'copy':
            raise RuntimeError('Copy failure')
        # Execute a real file merge through the same production copy method,
        # with only the external rsync process substituted in this fixture.
        super().copy_release(stage)

    def as_user(self, args, cwd=None, capture=False):
        if args[0] == 'python3':
            subprocess.run(args, check=True)
            return
        assert args[0] == 'rsync'
        assert '--delay-updates' in args and '--safe-links' in args
        assert '--delete' not in args
        for exclusion in ['--exclude=.data/', '--exclude=.env*', '--exclude=.git/', '--exclude=.deployed-commit']:
            assert exclusion in args
        for item in self.stage.iterdir():
            if item.name in {'.data', '.git', '.deployed-commit'} or item.name.startswith('.env'):
                continue
            destination = self.app / item.name
            if item.is_dir():
                shutil.copytree(item, destination, dirs_exist_ok=True)
            else:
                shutil.copy2(item, destination)

    def healthy(self):
        return self.fail != 'health'

    def wait_healthy(self):
        self.events.append('health')
        if not self.healthy():
            raise RuntimeError('Health failed')


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_success_preserves_database_environment_and_unrelated_files(self):
        updater = FixtureUpdater(self.root)
        (updater.app / '.data').mkdir()
        (updater.app / '.data/accounts.sqlite').write_text('existing accounts')
        (updater.app / '.env').write_text('existing configuration')
        (updater.app / 'local-file').write_text('keep')
        (updater.stage / '.data').mkdir()
        (updater.stage / '.data/accounts.sqlite').write_text('must not replace')
        (updater.stage / '.env').write_text('must not replace')
        (updater.stage / 'app.js').write_text('new code')
        updater.deploy()
        self.assertEqual((updater.app / '.data/accounts.sqlite').read_text(), 'existing accounts')
        self.assertEqual((updater.app / '.env').read_text(), 'existing configuration')
        self.assertEqual((updater.app / 'local-file').read_text(), 'keep')
        self.assertEqual((updater.app / 'app.js').read_text(), 'new code')
        self.assertEqual((updater.app / '.deployed-commit').read_text().strip(), updater.revision)
        self.assertEqual(updater.events, ['prepare', 'validate', 'stop', 'copy', 'start', 'health'])
        self.assertFalse(updater.stage.exists())

    def test_failed_checks_leave_running_app_untouched(self):
        updater = FixtureUpdater(self.root, 'validate')
        (updater.app / 'app.js').write_text('working code')
        with self.assertRaises(RuntimeError):
            updater.deploy()
        self.assertEqual((updater.app / 'app.js').read_text(), 'working code')
        self.assertEqual(updater.events, ['prepare', 'validate'])

    def test_failed_copy_starts_service_again_and_does_not_mark_success(self):
        updater = FixtureUpdater(self.root, 'copy')
        with self.assertRaises(RuntimeError):
            updater.deploy()
        self.assertEqual(updater.events[-1], 'start')
        self.assertFalse((updater.app / '.deployed-commit').exists())

    def test_failed_health_does_not_mark_success(self):
        updater = FixtureUpdater(self.root, 'health')
        with self.assertRaises(RuntimeError):
            updater.deploy()
        self.assertFalse((updater.app / '.deployed-commit').exists())
        self.assertIn('start', updater.events)

    def test_same_healthy_revision_does_not_restart_service(self):
        updater = FixtureUpdater(self.root)
        (updater.app / '.deployed-commit').write_text(updater.revision)
        updater.deploy()
        self.assertEqual(updater.events, ['prepare'])


if __name__ == '__main__':
    unittest.main()
