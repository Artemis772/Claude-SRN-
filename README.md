# Hospital Billing — Rate & Package Manager

A live portal for the hospital billing team showing the rate list, package master,
lens register and billing instructions, with an admin-approval workflow for any
suggested changes.

## Features
- **Four live data sections**: Rate List, Package Master, Lens Register, Billing Instructions
- **Two roles**:
  - **Admin** — adds/edits/deletes entries directly and approves billing-team requests
  - **Billing** — can suggest new entries, edits and deletions; nothing goes live until admin approves
- **Approvals queue** — admins see all pending requests with the full payload
- **Notice board** — every change (admin or approved-from-billing) shows up for **7 days**, then auto-disappears

## Quick start

```bash
npm install
npm start
```

Then open http://localhost:3000

### Default logins
- Admin:   `admin` / `admin123`
- Billing: `billing` / `billing123`

Change these in production via the database, or by editing `db.js` before first run.

## Stack
- Node.js + Express
- SQLite (via `better-sqlite3`) — file at `data/billing.db`
- bcryptjs + express-session for auth
- Vanilla HTML/CSS/JS frontend (no build step)

## Files
- `server.js` — Express app & API routes
- `db.js` — schema, seed users and sample data
- `public/index.html`, `public/styles.css`, `public/app.js` — frontend
- `data/billing.db` — auto-created on first run (gitignored)
