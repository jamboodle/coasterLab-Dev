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
      CREATE TABLE IF NOT EXISTS export_jobs(id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), fingerprint TEXT NOT NULL, count INTEGER NOT NULL, format TEXT NOT NULL, bytes BLOB NOT NULL, released INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL, UNIQUE(account,fingerprint));
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS identities(email TEXT PRIMARY KEY, account TEXT UNIQUE NOT NULL REFERENCES accounts(id), salt TEXT NOT NULL, digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS challenges(hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), purpose TEXT NOT NULL, expires INTEGER NOT NULL, credential_digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS account_controls(account TEXT PRIMARY KEY REFERENCES accounts(id), admin INTEGER NOT NULL DEFAULT 0, suspended INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_audit(id TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES accounts(id), action TEXT NOT NULL, target TEXT, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL);`);
    const columns=new Set(this.db.prepare('PRAGMA table_info(orders)').all().map(row=>row.name));
    if(!columns.has('request_key'))this.db.exec('ALTER TABLE orders ADD COLUMN request_key TEXT');
    if(!columns.has('created_at'))this.db.exec('ALTER TABLE orders ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0');
    for(const [name,definition] of [['payment_mode',"TEXT NOT NULL DEFAULT 'test'"],['pack_id',"TEXT NOT NULL DEFAULT 'starter'"],['amount','INTEGER NOT NULL DEFAULT 500'],['credits','INTEGER NOT NULL DEFAULT 10'],['currency',"TEXT NOT NULL DEFAULT 'usd'"]]){
      if(!columns.has(name))this.db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${definition}`);
    }
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS order_request_key ON orders(account,request_key); CREATE INDEX IF NOT EXISTS entries_account ON entries(account)');
    const identityColumns=new Set(this.db.prepare('PRAGMA table_info(identities)').all().map(row=>row.name));
    for(const [name,type] of [['name',"TEXT NOT NULL DEFAULT ''"],['joined_at','INTEGER'],['last_visited_at','INTEGER']])if(!identityColumns.has(name))this.db.exec(`ALTER TABLE identities ADD COLUMN ${name} ${type}`);
    if(!this.db.prepare('PRAGMA table_info(identities)').all().some(row=>row.name==='verified_at'))this.db.exec('ALTER TABLE identities ADD COLUMN verified_at INTEGER');
  }
  createAccount() {
    const id = randomBytes(16).toString('hex'), token = randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO accounts VALUES (?,?)').run(id,hash(token));
    return {id,token};
  }
  authenticate(token) {
    const id=typeof token==='string'?this.db.prepare('SELECT id FROM accounts WHERE token_hash=?').get(hash(token))?.id:undefined;
    return id && !this.control(id).suspended?id:undefined;
  }
  identity(email) {email=email.trim().toLowerCase();return this.db.prepare('SELECT * FROM identities WHERE email=?').get(email);}
  registerIdentity(email,salt,digest,name='') {
    email=email.trim().toLowerCase();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(this.identity(email)){this.db.exec('ROLLBACK');return null;}
      const {id}=this.createAccount();
      this.db.prepare('INSERT INTO identities(email,account,salt,digest,name,joined_at,last_visited_at) VALUES (?,?,?,?,?,?,?)').run(email,id,salt,digest,name,Date.now(),Date.now());
      const welcome=this.settings().welcomeCredits;
      if(welcome>0)this.db.prepare("INSERT INTO entries VALUES (?,?,?,'welcome')").run('welcome:'+id,id,welcome);
      this.db.exec('COMMIT');return id;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  allowAuth(address,now=Date.now()) {
    this.db.prepare('DELETE FROM auth_limits WHERE expires<=?').run(now);
    const key=hash(address);
    this.db.prepare('INSERT INTO auth_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+900000);
    return this.db.prepare('SELECT count FROM auth_limits WHERE key=?').get(key).count<=20;
  }
  touchVisit(account,now=Date.now()){this.db.prepare('UPDATE identities SET last_visited_at=? WHERE account=? AND (last_visited_at IS NULL OR last_visited_at<?)').run(now,account,now-60000);}
  updateName(account,name){this.db.prepare('UPDATE identities SET name=? WHERE account=?').run(name,account);}
  makerAccess(account){const registered=Boolean(account && this.identityForAccount(account)),credits=account?this.balance(account):0;return {registered,credits,maxImages:registered&&credits>0?6:1};}
  createSession(account) {
    this.touchVisit(account);
    const token=randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),account,Date.now()+86400000);
    return token;
  }
  sessionAccount(token) {
    const id=token?this.db.prepare('SELECT account FROM sessions WHERE hash=? AND expires>?').get(hash(token),Date.now())?.account:undefined;
    return id && !this.control(id).suspended?id:undefined;
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
      if(quote.remaining<0){this.db.exec('ROLLBACK');return {error:'Not enough credits. Download STL free or purchase more credits.',status:402};}
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
  checkoutOrder(account,key,now=Date.now(),pack={amount:500,credits:10,currency:'usd'},paymentMode='test') {
    this.db.prepare('INSERT OR IGNORE INTO orders(id,account,request_key,created_at,amount,credits,currency,pack_id,payment_mode) VALUES (?,?,?,?,?,?,?,?,?)').run(randomBytes(16).toString('hex'),account,key,now,pack.amount,pack.credits,pack.currency,pack.id || 'starter',paymentMode);
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
  creditPayment(event,paymentMode='test') {
    const s=event.data?.object;
    if (!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) return false;
    if(!['test','live'].includes(paymentMode))return false;
    const live=paymentMode==='live';
    if (event.livemode !== live || s?.livemode !== live || s.payment_status !== 'paid' || s.mode !== 'payment') return false;
    const order=this.db.prepare('SELECT * FROM orders WHERE session=?').get(s.id);
    if(!order){
      const pending=typeof s.metadata?.order_id==='string'?this.db.prepare('SELECT * FROM orders WHERE id=?').get(s.metadata.order_id):undefined;
      if(pending && !pending.session && pending.payment_mode===paymentMode)throw Error('Checkout attachment pending; retry webhook');
      return false;
    }
    if(order.payment_mode!==paymentMode)return false;
    if(s.amount_total!==order.amount || s.currency!==order.currency)return false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT OR IGNORE INTO events VALUES (?)').run(event.id);
      const result=this.db.prepare("INSERT OR IGNORE INTO entries VALUES (?,?,?,'purchase')").run('purchase:'+s.id,order.account,order.credits);
      this.db.exec('COMMIT');
      return result.changes === 1;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  control(account) {return this.db.prepare('SELECT admin,suspended FROM account_controls WHERE account=?').get(account) || {admin:0,suspended:0};}
  makeAdmin(email) {
    const identity=this.identity(email);if(!identity)throw Error('Create this account first.');
    this.db.prepare('INSERT INTO account_controls(account,admin) VALUES (?,1) ON CONFLICT(account) DO UPDATE SET admin=1,suspended=0').run(identity.account);
    this.revokeAllSessions(identity.account);return identity.account;
  }
  settings() {
    const defaults={paymentMode:'test',livePaymentsEnabled:false,liveSecretKey:'',liveWebhookSecret:'',welcomeCredits:15,billingEnabled:false,amount:500,credits:10,currency:'usd',additionalPacks:[{id:'standard',amount:1000,credits:50},{id:'large',amount:1500,credits:100}],secretKey:'',webhookSecret:''};
    for(const row of this.db.prepare('SELECT key,value FROM settings').all())if(Object.hasOwn(defaults,row.key))defaults[row.key]=JSON.parse(row.value);
    return defaults;
  }
  saveSettings(actor,values) {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const [key,value] of Object.entries(values))this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
      this.audit(actor,'settings',null,{changed:Object.keys(values)});
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  audit(actor,action,target,detail,id=randomBytes(16).toString('hex')) {
    this.db.prepare('INSERT INTO admin_audit VALUES (?,?,?,?,?,?)').run(id,actor,action,target,JSON.stringify(detail),Date.now());
  }
  users(search='',offset=0,{sort='name',direction='asc',limit=25}={}) {
    const sorts={name:"LOWER(COALESCE(NULLIF(i.name,''),i.email))",joined:'i.joined_at',lastVisited:'i.last_visited_at',credits:'credits'};
    if(!Object.hasOwn(sorts,sort)||!['asc','desc'].includes(direction)||![10,25,50].includes(limit))throw Error('Invalid sort or page size.');
    return this.db.prepare(`SELECT i.account,i.email,i.name,i.joined_at,i.last_visited_at,i.verified_at,COALESCE(c.admin,0) AS admin,COALESCE(c.suspended,0) AS suspended,
      COALESCE((SELECT SUM(delta) FROM entries WHERE account=i.account),0) AS credits
      FROM identities i LEFT JOIN account_controls c ON c.account=i.account
      WHERE instr(LOWER(i.email||' '||i.name),?)>0
      ORDER BY ${sorts[sort]} IS NULL ASC,${sorts[sort]} ${direction},i.email ASC LIMIT ? OFFSET ?`).all(search.trim().toLowerCase(),limit,offset);
  }
  usersCount(search=''){return this.db.prepare("SELECT COUNT(*) AS count FROM identities WHERE instr(LOWER(email||' '||name),?)>0").get(search.trim().toLowerCase()).count;}
  adjustCredits(actor,target,delta,reason,key) {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const prior=this.db.prepare('SELECT * FROM admin_audit WHERE id=?').get(key);
      if(prior){
        const detail=JSON.parse(prior.detail);
        if(prior.actor!==actor || prior.target!==target || detail.delta!==delta || detail.reason!==reason)throw Error('Adjustment reference already used.');
        this.db.exec('COMMIT');return this.balance(target);
      }
      if(!this.identityForAccount(target))throw Error('Account not found.');
      if(this.balance(target)+delta<0)throw Error('Adjustment would make the balance negative.');
      this.db.prepare("INSERT INTO entries VALUES (?,?,?,'admin_adjustment')").run('admin:'+key,target,delta);
      this.audit(actor,'credits',target,{delta,reason},key);
      this.db.exec('COMMIT');return this.balance(target);
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  suspend(actor,target,suspended) {
    if(actor===target || this.control(target).admin)throw Error('Administrator accounts cannot be suspended here.');
    if(!this.identityForAccount(target))throw Error('Account not found.');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('INSERT INTO account_controls(account,suspended) VALUES (?,?) ON CONFLICT(account) DO UPDATE SET suspended=excluded.suspended').run(target,Number(suspended));
      if(suspended)this.revokeAllSessions(target);
      this.audit(actor,'suspension',target,{suspended});this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  auditLog() {return this.db.prepare('SELECT a.actor,i.email AS actorEmail,a.action,a.target,t.email AS targetEmail,a.detail,a.created_at FROM admin_audit a LEFT JOIN identities i ON i.account=a.actor LEFT JOIN identities t ON t.account=a.target ORDER BY a.rowid DESC LIMIT 100').all();}
  pruneExports(now=Date.now()){this.db.prepare('DELETE FROM export_jobs WHERE expires<=?').run(now);}
  exportJob(account,id){return this.db.prepare('SELECT id,fingerprint,count,format,released,expires,length(bytes) AS size FROM export_jobs WHERE account=? AND id=? AND expires>?').get(account,id,Date.now());}
  storeExport(account,result){
    this.pruneExports();const existing=this.db.prepare('SELECT id FROM export_jobs WHERE account=? AND fingerprint=?').get(account,result.fingerprint);if(existing)return existing.id;
    let owner=this.db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(length(bytes)),0) AS size FROM export_jobs WHERE account=?').get(account);
    while(owner.count && (owner.count>=6||owner.size+result.bytes.length>100000000)){
      this.db.prepare('DELETE FROM export_jobs WHERE id=(SELECT id FROM export_jobs WHERE account=? ORDER BY expires,id LIMIT 1)').run(account);
      owner=this.db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(length(bytes)),0) AS size FROM export_jobs WHERE account=?').get(account);
    }
    const capacity=this.db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(length(bytes)),0) AS size FROM export_jobs').get();
    if(capacity.count>=100||capacity.size+result.bytes.length>512000000)throw Error('Export storage is busy. Try again later.');
    const id=randomBytes(16).toString('hex');this.db.prepare('INSERT INTO export_jobs(id,account,fingerprint,count,format,bytes,expires) VALUES (?,?,?,?,?,?,?)').run(id,account,result.fingerprint,result.count,result.format,result.bytes,Date.now()+86400000);return id;
  }
  releaseExport(account,id,billingEnabled,expectedCost){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const job=this.exportJob(account,id);if(!job){this.db.exec('ROLLBACK');return {error:'Export expired or not found. Prepare it again.',status:404};}
      const balance=this.balance(account);if(job.released){this.db.exec('COMMIT');return {cost:0,balance,remaining:balance,retry:true};}
      const quote=billingEnabled?this.exportQuote(account,job.fingerprint,job.count):{cost:0,balance,remaining:balance,retry:false};
      if(quote.error){this.db.exec('ROLLBACK');return quote;}
      if(quote.cost!==expectedCost){this.db.exec('ROLLBACK');return {error:'Export pricing changed. Check the cost and confirm again.',status:409};}
      if(quote.remaining<0){this.db.exec('ROLLBACK');return {error:'Not enough credits. Download STL free or purchase more credits.',status:402};}
      if(quote.cost>0){this.db.prepare('INSERT INTO export_trials VALUES (?,?,?)').run(account,job.fingerprint,job.count);this.db.prepare("INSERT INTO entries VALUES (?,?,?,'export_trial')").run('export:'+account+':'+job.fingerprint,account,-quote.cost);}
      this.db.prepare('UPDATE export_jobs SET released=1 WHERE id=? AND account=?').run(id,account);this.db.exec('COMMIT');return quote;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  exportBytes(account,id){return this.db.prepare('SELECT bytes FROM export_jobs WHERE account=? AND id=? AND released=1 AND expires>?').get(account,id,Date.now())?.bytes;}
  close() {this.db.close();}
}
