/* Hospital billing portal — frontend */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const TABLES = {
    rate_list: {
      label: 'Rate List',
      desc: 'Master price list of services, investigations and procedures.',
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'description', label: 'Description' },
        { key: 'department', label: 'Department' },
        { key: 'amount', label: 'Amount (Rs.)', type: 'currency' },
        { key: 'notes', label: 'Notes' },
      ],
      form: [
        { key: 'code', label: 'Code', required: true },
        { key: 'description', label: 'Description', required: true },
        { key: 'department', label: 'Department' },
        { key: 'amount', label: 'Amount (Rs.)', type: 'number', required: true },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
    packages: {
      label: 'Package Master',
      desc: 'Bundled service packages with fixed pricing.',
      columns: [
        { key: 'name', label: 'Package' },
        { key: 'description', label: 'Description' },
        { key: 'inclusions', label: 'Inclusions' },
        { key: 'amount', label: 'Amount (Rs.)', type: 'currency' },
        { key: 'notes', label: 'Notes' },
      ],
      form: [
        { key: 'name', label: 'Package Name', required: true },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'inclusions', label: 'Inclusions', type: 'textarea' },
        { key: 'amount', label: 'Amount (Rs.)', type: 'number', required: true },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
    lens_register: {
      label: 'Lens Register',
      desc: 'Intraocular lenses available with their billing prices.',
      columns: [
        { key: 'brand', label: 'Brand' },
        { key: 'model', label: 'Model' },
        { key: 'type', label: 'Type' },
        { key: 'power', label: 'Power' },
        { key: 'price', label: 'Price (Rs.)', type: 'currency' },
        { key: 'notes', label: 'Notes' },
      ],
      form: [
        { key: 'brand', label: 'Brand', required: true },
        { key: 'model', label: 'Model', required: true },
        { key: 'type',  label: 'Type' },
        { key: 'power', label: 'Power' },
        { key: 'price', label: 'Price (Rs.)', type: 'number', required: true },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
    billing_instructions: {
      label: 'Billing Instructions',
      desc: 'Standing instructions and billing rules for the team.',
      columns: [], // rendered as cards
      form: [
        { key: 'title',   label: 'Title',   required: true },
        { key: 'content', label: 'Content', required: true, type: 'textarea' },
      ],
    },
  };

  const state = {
    user: null,
    activeTab: 'rate_list',
    pendingCount: 0,
  };

  // ------ API helpers ------
  async function api(method, url, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      const msg = (data && data.error) || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  // ------ Toast ------
  function toast(msg, type = 'info') {
    const host = $('#toast-host');
    if (!host) { alert(msg); return; }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ------ Bootstrap ------
  async function init() {
    try {
      const me = await api('GET', '/api/me');
      state.user = me.user;
    } catch (e) {
      state.user = null;
    }
    if (!state.user) renderLogin(); else renderApp();
  }

  // ------ Login ------
  function renderLogin() {
    const tpl = $('#tpl-login').content.cloneNode(true);
    $('#app').replaceChildren(tpl);
    $('#login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const errEl = $('#login-error');
      errEl.hidden = true;
      try {
        const r = await api('POST', '/api/login', {
          username: fd.get('username'), password: fd.get('password'),
        });
        state.user = r.user;
        renderApp();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.hidden = false;
      }
    });
  }

  // ------ Main app ------
  function renderApp() {
    const tpl = $('#tpl-main').content.cloneNode(true);
    $('#app').replaceChildren(tpl);

    const role = state.user.role;
    $('#who').innerHTML = `<strong>${state.user.username}</strong> <span class="role-pill role-${role}">${role}</span>`;
    $('#logout-btn').addEventListener('click', logout);

    if (role !== 'admin') {
      const t = $('#tab-approvals');
      t.textContent = 'My Requests';
    }

    $$('#tabs button').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    switchTab(state.activeTab);
    refreshPendingCount();
  }

  async function logout() {
    await api('POST', '/api/logout');
    state.user = null;
    renderLogin();
  }

  function switchTab(tab) {
    state.activeTab = tab;
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'approvals')         renderApprovals();
    else if (tab === 'notice_board') renderNoticeBoard();
    else                             renderTable(tab);
  }

  async function refreshPendingCount() {
    if (state.user.role !== 'admin') return;
    try {
      const r = await api('GET', '/api/change-requests?status=pending');
      state.pendingCount = r.rows.length;
      const tab = $('#tab-approvals');
      const existing = tab.querySelector('.badge');
      if (existing) existing.remove();
      if (state.pendingCount > 0) {
        tab.insertAdjacentHTML('beforeend', ` <span class="badge">${state.pendingCount}</span>`);
      }
    } catch { /* ignore */ }
  }

  // ------ Tables ------
  async function renderTable(tableName) {
    const cfg = TABLES[tableName];
    const view = $('#view');
    const isAdmin = state.user.role === 'admin';
    const actionLabel = isAdmin ? 'Add' : 'Suggest new';

    view.innerHTML = `
      <div class="section-head">
        <div>
          <h2>${cfg.label}</h2>
          <div class="desc">${cfg.desc}</div>
        </div>
        <button class="btn-primary" id="add-btn">+ ${actionLabel}</button>
      </div>
      <div id="table-host"></div>
    `;
    $('#add-btn').addEventListener('click', () => openForm(tableName, 'create'));

    let rows = [];
    try { rows = (await api('GET', `/api/${tableName}`)).rows; }
    catch (e) { toast(e.message, 'error'); }

    if (tableName === 'billing_instructions') {
      renderInstructions(rows);
    } else {
      renderRowsTable(tableName, rows);
    }
  }

  function renderRowsTable(tableName, rows) {
    const cfg = TABLES[tableName];
    const isAdmin = state.user.role === 'admin';
    const host = $('#table-host');

    if (!rows.length) {
      host.innerHTML = `<div class="card"><div class="empty">No entries yet.</div></div>`;
      return;
    }

    const head = cfg.columns.map(c => `<th>${c.label}</th>`).join('') + '<th></th>';
    const body = rows.map(r => {
      const cells = cfg.columns.map(c => {
        let v = r[c.key];
        if (v == null || v === '') v = '<span style="color:#94a3b8">—</span>';
        else if (c.type === 'currency') v = formatCurrency(v);
        else v = escapeHtml(String(v));
        return `<td>${v}</td>`;
      }).join('');
      const editLabel   = isAdmin ? 'Edit'   : 'Suggest edit';
      const deleteLabel = isAdmin ? 'Delete' : 'Suggest delete';
      const actions = `
        <td class="actions">
          <button class="btn-secondary" data-act="edit"   data-id="${r.id}">${editLabel}</button>
          <button class="btn-danger"    data-act="delete" data-id="${r.id}">${deleteLabel}</button>
        </td>`;
      return `<tr>${cells}${actions}</tr>`;
    }).join('');

    host.innerHTML = `<div class="card"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;

    $$('button[data-act]', host).forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        const row = rows.find(r => r.id === id);
        if (btn.dataset.act === 'edit') openForm(tableName, 'update', row);
        else                            confirmDelete(tableName, row);
      });
    });
  }

  function renderInstructions(rows) {
    const isAdmin = state.user.role === 'admin';
    const host = $('#table-host');
    if (!rows.length) {
      host.innerHTML = `<div class="card"><div class="empty">No instructions yet.</div></div>`;
      return;
    }
    host.innerHTML = `<div class="instr-list">${rows.map(r => `
      <div class="instr-item">
        <h3>${escapeHtml(r.title)}</h3>
        <p>${escapeHtml(r.content)}</p>
        <div class="row-foot">
          <span>Updated ${formatDate(r.updated_at)}</span>
          <span>
            <button class="btn-secondary" data-act="edit"   data-id="${r.id}">${isAdmin ? 'Edit' : 'Suggest edit'}</button>
            <button class="btn-danger"    data-act="delete" data-id="${r.id}">${isAdmin ? 'Delete' : 'Suggest delete'}</button>
          </span>
        </div>
      </div>
    `).join('')}</div>`;

    $$('button[data-act]', host).forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        const row = rows.find(r => r.id === id);
        if (btn.dataset.act === 'edit') openForm('billing_instructions', 'update', row);
        else                            confirmDelete('billing_instructions', row);
      });
    });
  }

  // ------ Form modal ------
  function openForm(tableName, action, row) {
    const cfg = TABLES[tableName];
    const isAdmin = state.user.role === 'admin';
    const fields = cfg.form.map(f => {
      const value = row && row[f.key] != null ? row[f.key] : '';
      const required = f.required ? 'required' : '';
      const inputEl = f.type === 'textarea'
        ? `<textarea name="${f.key}" ${required}>${escapeHtml(String(value))}</textarea>`
        : `<input name="${f.key}" type="${f.type === 'number' ? 'number' : 'text'}"${f.type === 'number' ? ' step="0.01"' : ''} value="${escapeHtml(String(value))}" ${required} />`;
      return `<label>${f.label}${f.required ? ' *' : ''}${inputEl}</label>`;
    }).join('');

    const reasonField = !isAdmin
      ? `<label>Reason / Note (visible to admin)<textarea name="__reason"></textarea></label>`
      : '';

    const banner = !isAdmin
      ? `<div class="info-banner">Your ${action === 'create' ? 'new entry' : 'change'} will be sent for admin approval before going live.</div>`
      : '';

    const title = `${action === 'create' ? 'New' : 'Edit'} — ${cfg.label}`;
    showModal(title, `
      <form id="entry-form">
        ${banner}
        ${fields}
        ${reasonField}
      </form>
    `, [
      { label: 'Cancel', class: 'btn-secondary', onClick: closeModal },
      {
        label: isAdmin ? 'Save' : 'Submit for approval',
        class: 'btn-primary',
        onClick: async () => {
          const form = $('#entry-form');
          if (!form.reportValidity()) return;
          const fd = new FormData(form);
          const payload = {};
          for (const f of cfg.form) {
            const v = fd.get(f.key);
            if (v != null) payload[f.key] = (f.type === 'number' && v !== '') ? Number(v) : v;
          }
          if (!isAdmin) {
            const reason = fd.get('__reason');
            if (reason) payload.reason = reason;
          }
          try {
            if (action === 'create') {
              const r = await api('POST', `/api/${tableName}`, payload);
              toast(r.applied ? 'Saved.' : 'Sent for approval.', 'success');
            } else {
              const r = await api('PUT', `/api/${tableName}/${row.id}`, payload);
              toast(r.applied ? 'Updated.' : 'Change sent for approval.', 'success');
            }
            closeModal();
            switchTab(state.activeTab);
            refreshPendingCount();
          } catch (e) { toast(e.message, 'error'); }
        }
      },
    ]);
  }

  function confirmDelete(tableName, row) {
    const cfg = TABLES[tableName];
    const isAdmin = state.user.role === 'admin';
    const reasonField = !isAdmin
      ? `<label>Reason for deletion<textarea id="del-reason"></textarea></label>` : '';
    const desc = describeRow(tableName, row);
    const banner = !isAdmin
      ? `<div class="info-banner">A deletion request will be sent to admin for approval.</div>`
      : '';

    showModal(`Delete from ${cfg.label}`, `
      ${banner}
      <p>Are you sure you want to delete <strong>${escapeHtml(desc)}</strong>?</p>
      ${reasonField}
    `, [
      { label: 'Cancel', class: 'btn-secondary', onClick: closeModal },
      {
        label: isAdmin ? 'Delete' : 'Submit for approval',
        class: isAdmin ? 'btn-danger' : 'btn-primary',
        onClick: async () => {
          const body = {};
          if (!isAdmin) {
            const r = $('#del-reason'); if (r && r.value) body.reason = r.value;
          }
          try {
            const r = await api('DELETE', `/api/${tableName}/${row.id}`, body);
            toast(r.applied ? 'Deleted.' : 'Sent for approval.', 'success');
            closeModal();
            switchTab(state.activeTab);
            refreshPendingCount();
          } catch (e) { toast(e.message, 'error'); }
        }
      },
    ]);
  }

  // ------ Approvals ------
  async function renderApprovals() {
    const view = $('#view');
    const isAdmin = state.user.role === 'admin';
    view.innerHTML = `
      <div class="section-head">
        <div>
          <h2>${isAdmin ? 'Pending approvals' : 'My change requests'}</h2>
          <div class="desc">${isAdmin
            ? 'Review changes suggested by the billing team.'
            : 'Status of changes you have submitted.'}</div>
        </div>
        ${isAdmin ? `
          <div>
            <select id="status-filter">
              <option value="pending" selected>Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>` : ''}
      </div>
      <div id="approvals-host"></div>
    `;

    if (isAdmin) {
      $('#status-filter').addEventListener('change', loadApprovals);
    }
    loadApprovals();
  }

  async function loadApprovals() {
    const isAdmin = state.user.role === 'admin';
    const status = isAdmin ? ($('#status-filter')?.value || 'pending') : 'mine';
    const host = $('#approvals-host');
    host.innerHTML = `<div class="empty">Loading…</div>`;
    try {
      const url = isAdmin
        ? `/api/change-requests?status=${encodeURIComponent(status)}`
        : `/api/change-requests`;
      const r = await api('GET', url);
      const rows = r.rows;
      if (!rows.length) {
        host.innerHTML = `<div class="card"><div class="empty">Nothing here.</div></div>`;
        return;
      }
      host.innerHTML = rows.map(req => renderApprovalCard(req, isAdmin)).join('');
      if (isAdmin) wireApprovalButtons();
    } catch (e) {
      host.innerHTML = `<div class="card"><div class="empty">${escapeHtml(e.message)}</div></div>`;
    }
  }

  function renderApprovalCard(req, isAdmin) {
    const tableLabel = TABLES[req.table_name]?.label || req.table_name;
    const summary = describeRow(req.table_name, req.payload || {}) || '(no fields)';
    const payloadStr = JSON.stringify(req.payload || {}, null, 2);
    const reviewed = req.status !== 'pending'
      ? `<div class="meta">Reviewed ${formatDate(req.reviewed_at)}${req.review_note ? ' — note: ' + escapeHtml(req.review_note) : ''}</div>` : '';
    const actions = isAdmin && req.status === 'pending' ? `
      <div class="actions">
        <button class="btn-secondary" data-act="reject"  data-id="${req.id}">Reject</button>
        <button class="btn-success"   data-act="approve" data-id="${req.id}">Approve</button>
      </div>` : '';
    return `
      <div class="approval-card">
        <div class="meta">
          <span class="tag tag-${req.action}">${req.action}</span>
          <span class="tag tag-${req.status}">${req.status}</span>
          &nbsp;·&nbsp; ${escapeHtml(tableLabel)}
          &nbsp;·&nbsp; submitted by <strong>${escapeHtml(req.submitter)}</strong>
          on ${formatDate(req.submitted_at)}
        </div>
        <div class="summary">${escapeHtml(summary)}</div>
        ${req.reason ? `<div class="meta">Reason: ${escapeHtml(req.reason)}</div>` : ''}
        <pre>${escapeHtml(payloadStr)}</pre>
        ${reviewed}
        ${actions}
      </div>`;
  }

  function wireApprovalButtons() {
    $$('button[data-act="approve"]').forEach(b => {
      b.addEventListener('click', async () => {
        try { await api('POST', `/api/change-requests/${b.dataset.id}/approve`, {});
          toast('Approved.', 'success'); loadApprovals(); refreshPendingCount();
        } catch (e) { toast(e.message, 'error'); }
      });
    });
    $$('button[data-act="reject"]').forEach(b => {
      b.addEventListener('click', async () => {
        const note = prompt('Optional reason for rejection:');
        if (note === null) return; // cancelled
        try { await api('POST', `/api/change-requests/${b.dataset.id}/reject`, { note });
          toast('Rejected.', 'info'); loadApprovals(); refreshPendingCount();
        } catch (e) { toast(e.message, 'error'); }
      });
    });
  }

  // ------ Notice board ------
  async function renderNoticeBoard() {
    const view = $('#view');
    view.innerHTML = `
      <div class="section-head">
        <div>
          <h2>Notice Board</h2>
          <div class="desc">Approved changes from the past 7 days.</div>
        </div>
      </div>
      <div class="notice-banner">
        Each change appears here for 7 days from its date of approval, then is automatically removed.
      </div>
      <div id="notice-host"></div>
    `;
    try {
      const r = await api('GET', '/api/notice-board');
      const host = $('#notice-host');
      if (!r.rows.length) {
        host.innerHTML = `<div class="card"><div class="empty">No changes in the last 7 days.</div></div>`;
        return;
      }
      host.innerHTML = r.rows.map(n => `
        <div class="notice-item ${n.action}">
          <div class="summary">
            <span class="tag tag-${n.action}">${n.action}</span>
            ${escapeHtml(n.summary)}
          </div>
          <div class="meta">
            ${formatDate(n.performed_at)}
            ${n.performer ? ' · by ' + escapeHtml(n.performer) : ''}
            · expires ${expiresOn(n.performed_at)}
          </div>
        </div>
      `).join('');
    } catch (e) {
      $('#notice-host').innerHTML = `<div class="card"><div class="empty">${escapeHtml(e.message)}</div></div>`;
    }
  }

  // ------ Modal helpers ------
  function showModal(title, bodyHtml, buttons) {
    const host = $('#modal-host');
    host.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <header><h3>${escapeHtml(title)}</h3><button class="link" id="modal-close">Close</button></header>
          <div class="body">${bodyHtml}</div>
          <footer></footer>
        </div>
      </div>`;
    const footer = $('footer', host);
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.className = b.class; btn.textContent = b.label;
      btn.addEventListener('click', b.onClick);
      footer.appendChild(btn);
    });
    $('#modal-close').addEventListener('click', closeModal);
    $('.modal-backdrop', host).addEventListener('click', (ev) => {
      if (ev.target.classList.contains('modal-backdrop')) closeModal();
    });
  }
  function closeModal() { $('#modal-host').innerHTML = ''; }

  // ------ misc helpers ------
  function describeRow(table, p) {
    if (!p) return '';
    switch (table) {
      case 'rate_list':            return `${p.code || ''} — ${p.description || ''}`.trim();
      case 'packages':             return p.name || '';
      case 'lens_register':        return `${p.brand || ''} ${p.model || ''}`.trim();
      case 'billing_instructions': return p.title || '';
      default:                     return '';
    }
  }
  function formatCurrency(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return String(n);
    return v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function formatDate(s) {
    if (!s) return '';
    const d = new Date(s.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString();
  }
  function expiresOn(performedAt) {
    if (!performedAt) return '';
    const d = new Date(performedAt.replace(' ', 'T') + 'Z');
    d.setDate(d.getDate() + 7);
    return d.toLocaleDateString();
  }
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  init();
})();
