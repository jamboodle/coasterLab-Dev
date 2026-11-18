#!/usr/bin/env python3
"""Read-only comparison of retained migration data with the running database.

Never outputs credentials, settings values, email addresses or password hashes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys


def open_database(path):
    path = Path(path).resolve(strict=True)
    connection = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    connection.execute('PRAGMA query_only=ON')
    connection.execute('BEGIN')
    return connection


def rows(connection, table, key):
    cursor = connection.execute('SELECT * FROM "' + table + '"')
    names = [item[0] for item in cursor.description]
    return {row[names.index(key)]: dict(zip(names, row)) for row in cursor}


def compare(before, after):
    report = {'integrity': {}, 'tables': {}, 'balances': []}
    for label, connection in (('retained', before), ('current', after)):
        report['integrity'][label] = connection.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
    for table, key in (('accounts', 'id'), ('identities', 'email'), ('entries', 'id'),
                       ('orders', 'id'), ('events', 'id'), ('account_controls', 'account'), ('settings', 'key')):
        old, new = rows(before, table, key), rows(after, table, key)
        missing = old.keys() - new.keys()
        changed = sum(any(new[item].get(column) != value for column, value in old[item].items()
                          if column != 'last_visited_at') for item in old.keys() & new.keys())
        report['tables'][table] = {'before': len(old), 'now': len(new), 'missing': len(missing),
                                   'changed': changed, 'added': len(new.keys() - old.keys())}
    old_entries, new_entries = rows(before, 'entries', 'id'), rows(after, 'entries', 'id')
    old_balances, new_balances = {}, {}
    for entries, balances in ((old_entries, old_balances), (new_entries, new_balances)):
        for row in entries.values():
            balances[row['account']] = balances.get(row['account'], 0) + row['delta']
    for account in sorted(old_balances.keys() | new_balances.keys()):
        old, new = old_balances.get(account, 0), new_balances.get(account, 0)
        if old == new:
            continue
        additions = {}
        for key in new_entries.keys() - old_entries.keys():
            entry = new_entries[key]
            if entry['account'] == account:
                kind = entry['kind']
                additions[kind] = additions.get(kind, 0) + entry['delta']
        report['balances'].append({'account_ref': hashlib.sha256(account.encode()).hexdigest()[:12],
                                    'before': old, 'now': new, 'new_entries_by_kind': additions,
                                    'explained_by_new_entries': new - old == sum(additions.values())})
    return report


def running_database():
    def property(name):
        return subprocess.check_output(['systemctl', 'show', 'coasterprint-node', '-p', name, '--value'], text=True).strip()
    pid, working, user = property('MainPID'), property('WorkingDirectory'), property('User')
    if not pid.isdigit() or int(pid) <= 0:
        raise RuntimeError('Production service is not running.')
    environment = dict(value.decode().split('=', 1) for value in Path('/proc/' + pid + '/environ').read_bytes().split(b'\0') if b'=' in value)
    database = Path(environment.get('DATABASE_PATH', '.data/credits.sqlite'))
    if not database.is_absolute():
        database = Path(working) / database
    return database, {'service_user': user, 'working_directory': working, 'database': str(database),
                      'static_root': environment.get('STATIC_ROOT', '(not set)')}


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run this audit in the server root terminal.')
    parser = argparse.ArgumentParser()
    parser.add_argument('retained', help='Retained legacy-app directory or its credits.sqlite file')
    args = parser.parse_args()
    retained = Path(args.retained)
    if retained.is_dir():
        retained = retained / '.data/credits.sqlite'
    current, runtime = running_database()
    before, after = open_database(retained), open_database(current)
    try:
        report = compare(before, after)
    finally:
        before.close()
        after.close()
    print('Read-only audit; no balances or settings changed. Values and emails are withheld.')
    print(json.dumps({'runtime': runtime, **report}, indent=2))
    print('Changed settings, controls or credentials may reflect later admin activity. Missing records or changed old credit entries require investigation.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, sqlite3.Error, subprocess.CalledProcessError) as error:
        # Do not print database contents or potentially sensitive SQL errors.
        print('Audit could not complete (' + type(error).__name__ + '). Check the paths, service and database schema.', file=sys.stderr)
        sys.exit(1)
