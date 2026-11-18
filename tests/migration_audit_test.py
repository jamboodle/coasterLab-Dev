import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('migration_audit',Path(__file__).parents[1]/'scripts/audit-production-migration.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class AuditTests(unittest.TestCase):
    def test_read_only_audit_distinguishes_added_credits_from_missing_data(self):
        with tempfile.TemporaryDirectory() as directory:
            before,after=Path(directory)/'old.sqlite',Path(directory)/'new.sqlite'
            with sqlite3.connect(before) as db:
                for table,key in (('accounts','id'),('identities','email'),('orders','id'),('events','id'),('account_controls','account'),('settings','key')):
                    db.execute(f'CREATE TABLE {table}({key} TEXT PRIMARY KEY,value TEXT)')
                    db.execute(f'INSERT INTO {table} VALUES (?,?)',('private@example.com','private-value'))
                db.execute('CREATE TABLE entries(id TEXT PRIMARY KEY,account TEXT,delta INTEGER,kind TEXT)')
                db.execute("INSERT INTO entries VALUES ('original','customer',10,'purchase')")
            after.write_bytes(before.read_bytes())
            with sqlite3.connect(after) as db:
                db.execute("INSERT INTO entries VALUES ('admin-added','customer',20,'admin')")
            old=module.open_database(before);new=module.open_database(after)
            try:
                report=module.compare(old,new)
                self.assertEqual(report['tables']['entries'],{'before':1,'now':2,'missing':0,'changed':0,'added':1})
                self.assertEqual(report['balances'][0]['before'],10)
                self.assertEqual(report['balances'][0]['now'],30)
                self.assertTrue(report['balances'][0]['explained_by_new_entries'])
                self.assertNotIn('private@example.com',str(report));self.assertNotIn('private-value',str(report))
                with self.assertRaises(sqlite3.OperationalError):new.execute('DELETE FROM entries')
            finally:old.close();new.close()
            with sqlite3.connect(after) as db:db.execute("DELETE FROM entries WHERE id='original'")
            old=module.open_database(before);new=module.open_database(after)
            try:
                report=module.compare(old,new)
                self.assertEqual(report['tables']['entries']['missing'],1)
                self.assertFalse(report['balances'][0]['explained_by_new_entries'])
            finally:old.close();new.close()

if __name__=='__main__':unittest.main()
