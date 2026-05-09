const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));

// ---------- helpers ----------

const TABLES = {
  rate_list: {
    fields: ['code', 'description', 'department', 'amount', 'notes'],
    required: ['code', 'description', 'amount'],
    label: 'Rate List'
  },
  packages: {
    fields: ['name', 'description', 'inclusions', 'amount', 'notes'],
    required: ['name', 'amount'],
    label: 'Package Master'
  },
  lens_register: {
    fields: ['brand', 'model', 'type', 'power', 'price', 'notes'],
    required: ['brand', 'model', 'price'],
    label: 'Lens Register'
  },
  billing_instructions: {
    fields: ['title', 'content'],
    required: ['title', 'content'],
    label: 'Billing Instructions'
  }
};

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

function sanitizePayload(table, body) {
  const cfg = TABLES[table];
  if (!cfg) throw new Error('Unknown table');
  const out = {};
  for (const f of cfg.fields) {
    if (body[f] !== undefined && body[f] !== null && body[f] !== '') out[f] = body[f];
  }
  return out;
}

function describeRecord(table, payload) {
  switch (table) {
    case 'rate_list':            return `${payload.code || ''} — ${payload.description || ''}`.trim();
    case 'packages':             return payload.name || '';
    case 'lens_register':        return `${payload.brand || ''} ${payload.model || ''}`.trim();
    case 'billing_instructions': return payload.title || '';
    default:                     return '';
  }
}

function applyChange(table, action, recordId, payload, performedBy) {
  const cfg = TABLES[table];
  if (!cfg) throw new Error('Unknown table');

  let summary = '';
  let resultId = recordId;

  if (action === 'create') {
    const cols = cfg.fields.filter(f => payload[f] !== undefined);
    const placeholders = cols.map(() => '?').join(',');
    const values = cols.map(f => payload[f]);
    const stmt = db.prepare(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`
    );
    const info = stmt.run(...values);
    resultId = info.lastInsertRowid;
    summary = `Added "${describeRecord(table, payload)}" to ${cfg.label}`;
  } else if (action === 'update') {
    const cols = cfg.fields.filter(f => payload[f] !== undefined);
    if (cols.length === 0) throw new Error('Nothing to update');
    const setClause = cols.map(c => `${c} = ?`).join(', ');
    const values = cols.map(f => payload[f]);
    values.push(recordId);
    db.prepare(
      `UPDATE ${table} SET ${setClause}, updated_at = datetime('now') WHERE id = ?`
    ).run(...values);
    summary = `Updated "${describeRecord(table, payload)}" in ${cfg.label}`;
  } else if (action === 'delete') {
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(recordId);
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(recordId);
    summary = `Deleted "${describeRecord(table, existing || {})}" from ${cfg.label}`;
  }

  db.prepare(
    `INSERT INTO change_log (table_name, record_id, action, summary, details, performed_by)
     VALUES (?,?,?,?,?,?)`
  ).run(table, resultId, action, summary, JSON.stringify(payload), performedBy);

  return { id: resultId, summary };
}

// ---------- auth routes ----------

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

// ---------- write actions ----------
// Admin: applies immediately. Billing: creates a change_request.

function handleWriteRequest(req, res, table, action, recordId) {
  const cfg = TABLES[table];
  if (!cfg) return res.status(404).json({ error: 'Unknown table' });

  let payload = {};
  if (action !== 'delete') {
    payload = sanitizePayload(table, req.body || {});
    for (const r of cfg.required) {
      if (action === 'create' && (payload[r] === undefined || payload[r] === '')) {
        return res.status(400).json({ error: `Field "${r}" is required` });
      }
    }
  }
  const reason = (req.body && req.body.reason) || null;

  if (req.session.user.role === 'admin') {
    try {
      const result = applyChange(table, action, recordId, payload, req.session.user.id);
      return res.json({ applied: true, ...result });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  const info = db.prepare(
    `INSERT INTO change_requests (table_name, record_id, action, payload, reason, submitted_by)
     VALUES (?,?,?,?,?,?)`
  ).run(table, recordId || null, action, JSON.stringify(payload), reason, req.session.user.id);
  res.json({ applied: false, requestId: info.lastInsertRowid });
}

// ---------- change requests ----------

app.get('/api/change-requests', requireAuth, (req, res) => {
  const status = req.query.status || 'pending';
  const role = req.session.user.role;
  let rows;
  if (role === 'admin') {
    rows = db.prepare(
      `SELECT cr.*, u.username AS submitter
         FROM change_requests cr
         JOIN users u ON u.id = cr.submitted_by
        WHERE cr.status = ?
        ORDER BY cr.submitted_at DESC`
    ).all(status);
  } else {
    rows = db.prepare(
      `SELECT cr.*, u.username AS submitter
         FROM change_requests cr
         JOIN users u ON u.id = cr.submitted_by
        WHERE cr.submitted_by = ?
        ORDER BY cr.submitted_at DESC
        LIMIT 100`
    ).all(req.session.user.id);
  }
  res.json({ rows: rows.map(r => ({ ...r, payload: safeJson(r.payload) })) });
});

app.post('/api/change-requests/:id/approve', requireAdmin, (req, res) => {
  const cr = db.prepare('SELECT * FROM change_requests WHERE id = ?').get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Not found' });
  if (cr.status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });

  try {
    const payload = safeJson(cr.payload) || {};
    const result = applyChange(cr.table_name, cr.action, cr.record_id, payload, req.session.user.id);
    db.prepare(
      `UPDATE change_requests
          SET status='approved', reviewed_by=?, reviewed_at=datetime('now'), review_note=?
        WHERE id=?`
    ).run(req.session.user.id, req.body?.note || null, cr.id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/change-requests/:id/reject', requireAdmin, (req, res) => {
  const cr = db.prepare('SELECT * FROM change_requests WHERE id = ?').get(req.params.id);
  if (!cr) return res.status(404).json({ error: 'Not found' });
  if (cr.status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });
  db.prepare(
    `UPDATE change_requests
        SET status='rejected', reviewed_by=?, reviewed_at=datetime('now'), review_note=?
      WHERE id=?`
  ).run(req.session.user.id, req.body?.note || null, cr.id);
  res.json({ ok: true });
});

// ---------- notice board (changes within last 7 days) ----------

app.get('/api/notice-board', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT cl.*, u.username AS performer
       FROM change_log cl
       LEFT JOIN users u ON u.id = cl.performed_by
      WHERE cl.performed_at >= datetime('now', '-7 days')
      ORDER BY cl.performed_at DESC`
  ).all();
  res.json({ rows });
});

// ---------- generic table data + write routes (must be LAST so specific /api/* routes win) ----------

app.get('/api/:table', requireAuth, (req, res) => {
  const { table } = req.params;
  if (!TABLES[table]) return res.status(404).json({ error: 'Unknown table' });
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY updated_at DESC, id DESC`).all();
  res.json({ rows });
});

app.post('/api/:table',       requireAuth, (req, res) => handleWriteRequest(req, res, req.params.table, 'create', null));
app.put('/api/:table/:id',    requireAuth, (req, res) => handleWriteRequest(req, res, req.params.table, 'update', Number(req.params.id)));
app.delete('/api/:table/:id', requireAuth, (req, res) => handleWriteRequest(req, res, req.params.table, 'delete', Number(req.params.id)));

// ---------- helpers ----------

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// ---------- static frontend ----------

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Hospital billing app running on http://localhost:${PORT}`);
});
