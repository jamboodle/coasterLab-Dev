"""Root-owned release handoff. No application data or development-home dependency."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile
import tempfile

STORE = Path('/var/lib/coasterprint/releases')
MAX_ARCHIVE = 256 * 1024 * 1024

def revision_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{40}', value):
        raise RuntimeError('Use a complete 40-character release commit.')
    return value

def open_regular(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    info = os.fstat(descriptor)
    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_ARCHIVE:
        os.close(descriptor)
        raise RuntimeError('Expected a regular release archive smaller than 256 MiB.')
    return os.fdopen(descriptor, 'rb')

def archive_members(path):
    total = 0
    with tarfile.open(path, 'r:') as archive:
        for index, member in enumerate(archive):
            parts = PurePosixPath(member.name).parts
            if index > 10000 or member.name.startswith('/') or '..' in parts or not (member.isfile() or member.isdir()):
                raise RuntimeError('Release archives must contain only safe regular files and directories.')
            if any(part in ('.data', '.git') or (part.startswith('.env') and part != '.env.example') for part in parts):
                raise RuntimeError('Release archives must not contain private runtime data or secrets.')
            total += member.size
            if total > MAX_ARCHIVE:
                raise RuntimeError('Unpacked release exceeds 256 MiB.')

def write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    with open(temporary, 'w') as output:
        os.chmod(temporary, 0o600)
        json.dump(value, output)
        output.write('\n')
    os.replace(temporary, path)

def stage_release(source, revision, store=STORE, expected_digest=None):
    revision_id(revision)
    if store.is_symlink():
        raise RuntimeError('Release store must not be a symlink.')
    store.mkdir(parents=True, exist_ok=True, mode=0o700)
    if store.stat().st_uid != os.geteuid() or store.stat().st_mode & 0o022:
        raise RuntimeError('Release store has unsafe ownership or write permissions.')
    os.chmod(store, 0o700)
    descriptor, temporary_name = tempfile.mkstemp(prefix='.release-', dir=store)
    temporary = Path(temporary_name)
    try:
        digest = hashlib.sha256()
        total = 0
        with open_regular(source) as incoming, os.fdopen(descriptor, 'wb') as output:
            for chunk in iter(lambda: incoming.read(1024 * 1024), b''):
                total += len(chunk)
                if total > MAX_ARCHIVE:
                    raise RuntimeError('Release archive grew beyond the size limit.')
                digest.update(chunk)
                output.write(chunk)
        checksum = digest.hexdigest()
        if expected_digest is not None and checksum != expected_digest:
            raise RuntimeError('Release archive SHA-256 does not match.')
        archive_members(temporary)
        os.replace(temporary, store / (revision + '.tar'))
        write_json(store / (revision + '.json'), {'revision': revision, 'sha256': checksum})
        write_json(store / 'candidate.json', {'revision': revision})
        return revision
    finally:
        temporary.unlink(missing_ok=True)

def load_release(revision=None, store=STORE):
    if store.is_symlink() or not store.is_dir() or store.stat().st_uid != os.geteuid() or store.stat().st_mode & 0o022:
        raise RuntimeError('A trusted production release store is required.')
    if revision is None:
        with open_regular(store / 'candidate.json') as incoming:
            revision = json.load(incoming)['revision']
    revision_id(revision)
    with open_regular(store / (revision + '.json')) as incoming:
        manifest = json.load(incoming)
    if manifest.get('revision') != revision or not re.fullmatch(r'[0-9a-f]{64}', manifest.get('sha256', '')):
        raise RuntimeError('Invalid release manifest.')
    archive = store / (revision + '.tar')
    with open_regular(archive) as incoming:
        checksum = hashlib.file_digest(incoming, 'sha256').hexdigest()
    if checksum != manifest['sha256']:
        raise RuntimeError('Stored release archive failed its integrity check.')
    archive_members(archive)
    return revision, archive
