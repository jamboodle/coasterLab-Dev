import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('artifacts',Path(__file__).parents[1]/'scripts/release_artifacts.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ReleaseTests(unittest.TestCase):
    def test_package_integrity_and_safe_archive_members(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);source=root/'source.tar';store=root/'releases'
            with tarfile.open(source,'w') as archive:
                info=tarfile.TarInfo('dist/index.html');info.size=4;archive.addfile(info,io.BytesIO(b'app!'))
            revision=module.stage_release(source,'b'*40,store)
            source.unlink()
            self.assertEqual(module.load_release(None,store)[0],revision)
            with self.assertRaisesRegex(RuntimeError,'SHA-256'):
                module.stage_release(store/(revision+'.tar'),'c'*40,store,expected_digest='0'*64)
            for name,kind in [('../escape','file'),('/absolute','file'),('.data/credits.sqlite','file'),('.env','file'),('link','symlink')]:
                with tarfile.open(source,'w') as archive:
                    info=tarfile.TarInfo(name)
                    if kind=='symlink':info.type=tarfile.SYMTYPE;info.linkname='/etc/passwd';archive.addfile(info)
                    else:info.size=1;archive.addfile(info,io.BytesIO(b'x'))
                with self.assertRaises(RuntimeError):module.stage_release(source,'d'*40,store)
            self.assertEqual(module.load_release(None,store)[0],revision)

if __name__=='__main__':unittest.main()
