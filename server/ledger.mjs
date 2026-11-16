import {DatabaseSync} from 'node:sqlite';
import {randomBytes, createHash} from 'node:crypto';
const hash = token => createHash('sha256').update(token).digest('hex');
export class Ledger {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), session TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), delta INTEGER NOT NULL, kind TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS identities(email TEXT PRIMARY KEY, account TEXT UNIQUE NOT NULL REFERENCES accounts(id), salt TEXT NOT NULL, digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL);`);
  }
  createAccount() {
    const id = randomBytes(16).toString('hex'), token = randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO accounts VALUES (?,?)').run(id,hash(token));
    return {id,token};
  }
  authenticate(token) {
    return typeof token === 'string' ? this.db.prepare('SELECT id FROM accounts WHERE token_hash=?').get(hash(token))?.id : undefined;
  }
  identity(email) {return this.db.prepare('SELECT * FROM identities WHERE email=?').get(email);}
  registerIdentity(email,salt,digest) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(this.identity(email)){this.db.exec('ROLLBACK');return null;}
      const {id}=this.createAccount();
      this.db.prepare('INSERT INTO identities VALUES (?,?,?,?)').run(email,id,salt,digest);
      this.db.exec('COMMIT');return id;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  allowAuth(address,now=Date.now()) {
    this.db.prepare('DELETE FROM auth_limits WHERE expires<=?').run(now);
    const key=hash(address);
    this.db.prepare('INSERT INTO auth_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+900000);
    return this.db.prepare('SELECT count FROM auth_limits WHERE key=?').get(key).count<=20;
  }
  createSession(account) {
    const token=randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),account,Date.now()+86400000);
    return token;
  }
  sessionAccount(token) {
    return token ? this.db.prepare('SELECT account FROM sessions WHERE hash=? AND expires>?').get(hash(token),Date.now())?.account : undefined;
  }
  revokeSession(token) { if(token)this.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token)); }
  balance(account) {
    return this.db.prepare('SELECT COALESCE(SUM(delta),0) AS balance FROM entries WHERE account=?').get(account).balance;
  }
  createOrder(account) {
    const id=randomBytes(16).toString('hex');
    this.db.prepare('INSERT INTO orders(id,account) VALUES (?,?)').run(id,account);
    return id;
  }
  attachSession(id,session) { this.db.prepare('UPDATE orders SET session=? WHERE id=? AND session IS NULL').run(session,id); }
  creditPayment(event) {
    const s=event.data?.object;
    if (!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) return false;
    if (event.livemode !== false || s?.livemode !== false || s.payment_status !== 'paid' || s.mode !== 'payment' || s.amount_total !== 500 || s.currency !== 'usd') return false;
    const order=this.db.prepare('SELECT * FROM orders WHERE session=?').get(s.id);
    if (!order) throw new Error('Unknown checkout session');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT OR IGNORE INTO events VALUES (?)').run(event.id);
      const result=this.db.prepare("INSERT OR IGNORE INTO entries VALUES (?,?,10,'purchase')").run('purchase:'+s.id,order.account);
      this.db.exec('COMMIT');
      return result.changes === 1;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() {this.db.close();}
}
