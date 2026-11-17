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
      CREATE TABLE IF NOT EXISTS export_trials(account TEXT NOT NULL REFERENCES accounts(id), fingerprint TEXT NOT NULL, cost INTEGER NOT NULL CHECK(cost BETWEEN 1 AND 10), PRIMARY KEY(account,fingerprint));
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS identities(email TEXT PRIMARY KEY, account TEXT UNIQUE NOT NULL REFERENCES accounts(id), salt TEXT NOT NULL, digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS challenges(hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), purpose TEXT NOT NULL, expires INTEGER NOT NULL, credential_digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL);`);
    const columns=new Set(this.db.prepare('PRAGMA table_info(orders)').all().map(row=>row.name));
    if(!columns.has('request_key'))this.db.exec('ALTER TABLE orders ADD COLUMN request_key TEXT');
    if(!columns.has('created_at'))this.db.exec('ALTER TABLE orders ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS order_request_key ON orders(account,request_key)');
    if(!this.db.prepare('PRAGMA table_info(identities)').all().some(row=>row.name==='verified_at'))this.db.exec('ALTER TABLE identities ADD COLUMN verified_at INTEGER');
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
      this.db.prepare('INSERT INTO identities(email,account,salt,digest) VALUES (?,?,?,?)').run(email,id,salt,digest);
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
  identityForAccount(account) {return this.db.prepare('SELECT * FROM identities WHERE account=?').get(account);}
  revokeAllSessions(account) {
    this.db.prepare('DELETE FROM sessions WHERE account=?').run(account);
    this.db.prepare('UPDATE accounts SET token_hash=? WHERE id=?').run(hash(randomBytes(32).toString('hex')),account);
  }
  changePassword(account,expectedDigest,salt,digest) {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const result=this.db.prepare('UPDATE identities SET salt=?,digest=? WHERE account=? AND digest=?').run(salt,digest,account,expectedDigest);
      if(!result.changes){this.db.exec('ROLLBACK');return false;}
      this.revokeAllSessions(account);this.db.prepare('DELETE FROM challenges WHERE account=?').run(account);this.db.exec('COMMIT');return true;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  issueChallenge(account,purpose,now=Date.now()) {
    if(!['verify','reset'].includes(purpose))throw Error('Invalid challenge purpose');
    const identity=this.identityForAccount(account);if(!identity)return null;
    const token=randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM challenges WHERE expires<=? OR (account=? AND purpose=?)').run(now,account,purpose);
    this.db.prepare('INSERT INTO challenges VALUES (?,?,?,?,?)').run(hash(token),account,purpose,now+(purpose==='reset'?1800000:86400000),identity.digest);
    return token;
  }
  challenge(token,purpose,now=Date.now()) {
    if(typeof token!=='string' || !/^[a-f0-9]{64}$/.test(token))return null;
    return this.db.prepare('SELECT * FROM challenges WHERE hash=? AND purpose=? AND expires>?').get(hash(token),purpose,now) || null;
  }
  verifyEmail(token) {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const challenge=this.challenge(token,'verify');
      if(!challenge){this.db.exec('ROLLBACK');return false;}
      this.db.prepare('UPDATE identities SET verified_at=COALESCE(verified_at,?) WHERE account=?').run(Date.now(),challenge.account);
      this.db.prepare('DELETE FROM challenges WHERE hash=?').run(challenge.hash);
      this.db.exec('COMMIT');return true;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  resetPassword(token,salt,digest) {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const challenge=this.challenge(token,'reset');
      if(!challenge){this.db.exec('ROLLBACK');return false;}
      const result=this.db.prepare('UPDATE identities SET salt=?,digest=? WHERE account=? AND digest=?').run(salt,digest,challenge.account,challenge.credential_digest);
      if(!result.changes){this.db.exec('ROLLBACK');return false;}
      this.revokeAllSessions(challenge.account);
      this.db.prepare('DELETE FROM challenges WHERE account=?').run(challenge.account);
      this.db.exec('COMMIT');return true;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  activity(account) {
    return this.db.prepare('SELECT delta,kind FROM entries WHERE account=? ORDER BY rowid DESC LIMIT 50').all(account);
  }
  balance(account) {
    return this.db.prepare('SELECT COALESCE(SUM(delta),0) AS balance FROM entries WHERE account=?').get(account).balance;
  }
  exportQuote(account,fingerprint,count) {
    const existing=this.db.prepare('SELECT cost FROM export_trials WHERE account=? AND fingerprint=?').get(account,fingerprint);
    if(existing && existing.cost!==count)return {error:'Export count does not match the original request',status:409};
    const cost=existing?0:count,balance=this.balance(account);
    return {cost,balance,remaining:balance-cost,retry:Boolean(existing)};
  }
  debitExport(account,fingerprint,count) {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const quote=this.exportQuote(account,fingerprint,count);
      if(quote.error){this.db.exec('ROLLBACK');return quote;}
      if(quote.remaining<0){this.db.exec('ROLLBACK');return {error:'Not enough test credits',status:402};}
      if(!quote.retry){
        this.db.prepare('INSERT INTO export_trials VALUES (?,?,?)').run(account,fingerprint,count);
        this.db.prepare("INSERT INTO entries VALUES (?,?,?,'export_trial')").run('export:'+account+':'+fingerprint,account,-count);
      }
      this.db.exec('COMMIT');return quote;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  grantTestCredits(account,count) {
    if(!Number.isInteger(count)||count<1||count>1000)throw Error('Use 1 to 1000 test credits');
    this.db.prepare("INSERT INTO entries VALUES (?,?,?,'test_grant')").run('grant:'+randomBytes(16).toString('hex'),account,count);
  }
  checkoutOrder(account,key,now=Date.now()) {
    this.db.prepare('INSERT OR IGNORE INTO orders(id,account,request_key,created_at) VALUES (?,?,?,?)').run(randomBytes(16).toString('hex'),account,key,now);
    return this.db.prepare('SELECT * FROM orders WHERE account=? AND request_key=?').get(account,key);
  }
  orderStatus(account,id,now=Date.now()) {
    const order=this.db.prepare('SELECT * FROM orders WHERE id=? AND account=?').get(id,account);
    if(!order)return null;
    if(order.session && this.db.prepare('SELECT 1 FROM entries WHERE id=? AND account=?').get('purchase:'+order.session,account))return 'confirmed';
    return now>=order.created_at+3600000?'expired':'pending';
  }
  createOrder(account) {
    const id=randomBytes(16).toString('hex');
    this.db.prepare('INSERT INTO orders(id,account,created_at) VALUES (?,?,?)').run(id,account,Date.now());
    return id;
  }
  attachSession(id,session) {
    const result=this.db.prepare('UPDATE orders SET session=? WHERE id=? AND (session IS NULL OR session=?)').run(session,id,session);
    if(result.changes!==1)throw new Error('Checkout session mismatch');
  }
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
