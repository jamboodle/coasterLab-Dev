#!/usr/bin/env python3
"""Set upload/response bounds for the existing Webuzo app proxy."""
import os
from pathlib import Path
import subprocess
import sys

def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run this in the server root terminal.')
    environment = sys.argv[1] if len(sys.argv) == 2 else 'development'
    if environment not in ('development', 'production') or len(sys.argv) > 2:
        raise RuntimeError('Choose development or production.')
    domain = 'dev.jamboodle.com' if environment == 'development' else 'coasterprint.com'
    path = Path('/var/webuzo-data/nginx/custom/domains/' + domain + '.conf')
    if not path.is_file() or path.is_symlink():
        raise RuntimeError('Expected the existing domain proxy configuration.')
    original = path.read_text()
    marker = '# CoasterPrint private export delivery'
    if marker in original:
        print('Export proxy settings are already installed.')
        return
    if any(word in original for word in ('client_max_body_size', 'proxy_read_timeout', 'client_body_timeout')):
        raise RuntimeError('Custom upload/time limits already exist. Review this file before changing them: ' + str(path))
    block = marker + '\nclient_max_body_size 32m;\nclient_body_timeout 30s;\nproxy_read_timeout 90s;\nproxy_send_timeout 90s;\n\n'
    nginx = '/usr/local/apps/nginx/sbin/nginx'
    try:
        path.write_text(block + original)
        subprocess.run([nginx, '-t'], check=True, timeout=15)
        subprocess.run([nginx, '-s', 'reload'], check=True, timeout=15)
    except BaseException:
        path.write_text(original)
        raise
    print('Private export upload settings installed for ' + domain)

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print('Proxy configuration failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
