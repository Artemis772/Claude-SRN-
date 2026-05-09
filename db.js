const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'billing.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('admin','billing')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rate_list (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL,
    description TEXT NOT NULL,
    department  TEXT,
    amount      REAL NOT NULL,
    notes       TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS packages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    inclusions  TEXT,
    amount      REAL NOT NULL,
    notes       TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lens_register (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    brand     TEXT NOT NULL,
    model     TEXT NOT NULL,
    type      TEXT,
    power     TEXT,
    price     REAL NOT NULL,
    notes     TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS billing_instructions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS change_requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name    TEXT NOT NULL,
    record_id     INTEGER,
    action        TEXT NOT NULL CHECK(action IN ('create','update','delete')),
    payload       TEXT NOT NULL,
    reason        TEXT,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    submitted_by  INTEGER NOT NULL REFERENCES users(id),
    submitted_at  TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_by   INTEGER REFERENCES users(id),
    reviewed_at   TEXT,
    review_note   TEXT
  );

  CREATE TABLE IF NOT EXISTS change_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name    TEXT NOT NULL,
    record_id     INTEGER,
    action        TEXT NOT NULL,
    summary       TEXT NOT NULL,
    details       TEXT,
    performed_by  INTEGER REFERENCES users(id),
    performed_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function seedUsers() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const insert = db.prepare(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
  );
  insert.run('admin',   bcrypt.hashSync('admin123',   10), 'admin');
  insert.run('billing', bcrypt.hashSync('billing123', 10), 'billing');
  console.log('[seed] Created default users: admin/admin123, billing/billing123');
}

function seedSampleData() {
  const hasRates = db.prepare('SELECT COUNT(*) AS n FROM rate_list').get().n;
  if (hasRates === 0) {
    const r = db.prepare(
      'INSERT INTO rate_list (code, description, department, amount, notes) VALUES (?,?,?,?,?)'
    );
    r.run('CONS-OPD', 'OPD Consultation',         'OPD',        500,  'Regular OPD visit');
    r.run('CBC-001',  'Complete Blood Count',     'Laboratory', 350,  'Fasting not required');
    r.run('XRAY-CHE', 'X-Ray Chest PA View',      'Radiology',  450,  null);
    r.run('USG-ABD',  'Ultrasound Abdomen',       'Radiology',  1200, 'Patient must be fasting');
    r.run('ECG-001',  '12-Lead ECG',              'Cardiology', 300,  null);
  }

  const hasPkg = db.prepare('SELECT COUNT(*) AS n FROM packages').get().n;
  if (hasPkg === 0) {
    const p = db.prepare(
      'INSERT INTO packages (name, description, inclusions, amount, notes) VALUES (?,?,?,?,?)'
    );
    p.run('Master Health Checkup', 'Comprehensive annual health screening',
      'CBC, LFT, KFT, Lipid Profile, ECG, X-Ray Chest, USG Abdomen, Physician Consultation',
      4500, 'Half-day fasting required');
    p.run('Cataract Surgery (Standard)', 'Phacoemulsification with monofocal IOL',
      'Pre-op evaluation, surgery, IOL, 2 follow-up visits', 22000, 'Excludes premium IOL');
    p.run('Normal Delivery Package', 'Vaginal delivery with 3-day stay',
      'Labour room, delivery charges, paediatrician, room (twin sharing) x 3 days',
      35000, 'Excludes complications and NICU');
  }

  const hasLens = db.prepare('SELECT COUNT(*) AS n FROM lens_register').get().n;
  if (hasLens === 0) {
    const l = db.prepare(
      'INSERT INTO lens_register (brand, model, type, power, price, notes) VALUES (?,?,?,?,?,?)'
    );
    l.run('Alcon',         'AcrySof IQ',     'Monofocal Aspheric', '+21.0 D', 8500,  'Most common');
    l.run('Alcon',         'PanOptix',       'Trifocal',           '+22.0 D', 65000, 'Premium');
    l.run('Johnson&Johnson','Tecnis Eyhance','EDOF',               '+20.5 D', 28000, null);
    l.run('Bausch&Lomb',   'enVista',        'Monofocal',          '+21.5 D', 9500,  null);
  }

  const hasIns = db.prepare('SELECT COUNT(*) AS n FROM billing_instructions').get().n;
  if (hasIns === 0) {
    const i = db.prepare(
      'INSERT INTO billing_instructions (title, content) VALUES (?,?)'
    );
    i.run('GST on Implants',
      'GST is applicable on all implants and consumables. Verify HSN code before billing. Hospital services remain GST-exempt.');
    i.run('Insurance / TPA Cases',
      'Pre-authorisation must be obtained before admission. Discharge summary, final bill and investigation reports to be uploaded within 24 hours of discharge.');
    i.run('Senior Citizen Discount',
      '10% discount on consultation and diagnostics for patients aged 65+. Discount does not apply to packages, implants or pharmacy.');
    i.run('Refund Policy',
      'Refunds approved by admin only. Cash refunds above Rs. 10,000 require finance department sign-off.');
  }
}

seedUsers();
seedSampleData();

module.exports = db;
