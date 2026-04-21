const PASSCODE = 'UPSAMC1';
const STORAGE_KEY = 'upsamc_records';
const SESSION_KEY = 'upsamc_session';
const API = 'http://localhost:3000/api';
const WS_URL = 'ws://localhost:3000';

// ─── Helpers ───────────────────────────────────────────────────────────────
function getRecords() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}
function saveRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}
function getSession() {
  return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
}
function saveSession(data) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
}
function logActivity(action) {
  const session = getSession();
  if (!session) return;
  const now = new Date();
  const time = now.toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' });
  session.activity.push({ time, action });
  saveSession(session);
}
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GH', { day: '2-digit', month: 'short', year: 'numeric' });
}
function todayISO() {
  return new Date().toISOString().split('T')[0];
}
function nowTime() {
  const now = new Date();
  return now.toTimeString().slice(0, 5); // HH:MM
}
function buildVitals() {
  const sys    = document.getElementById('f_bp_sys')?.value.trim();
  const dia    = document.getElementById('f_bp_dia')?.value.trim();
  const temp   = document.getElementById('f_temp')?.value.trim();
  const pulse  = document.getElementById('f_pulse')?.value.trim();
  const weight = document.getElementById('f_weight')?.value.trim();
  const height = document.getElementById('f_height')?.value.trim();
  const spo2   = document.getElementById('f_spo2')?.value.trim();
  const other  = document.getElementById('f_vitals_other')?.value.trim();
  const parts = [];
  if (sys && dia)  parts.push(`BP: ${sys}/${dia} mmHg`);
  if (temp)        parts.push(`Temp: ${temp}°C`);
  if (pulse)       parts.push(`Pulse: ${pulse} bpm`);
  if (weight)      parts.push(`Weight: ${weight} kg`);
  if (height)      parts.push(`Height: ${height} cm`);
  if (spo2)        parts.push(`SpO₂: ${spo2}%`);
  if (other)       parts.push(other);
  return parts.join(', ');
}

function parseVitals(str) {
  const get = (pattern) => { const m = str?.match(pattern); return m ? m[1] : ''; };
  const bp  = str?.match(/BP:\s*(\d+)\/(\d+)/);
  return {
    sys:    bp ? bp[1] : '',
    dia:    bp ? bp[2] : '',
    temp:   get(/Temp:\s*([\d.]+)/),
    pulse:  get(/Pulse:\s*(\d+)/),
    weight: get(/Weight:\s*([\d.]+)/),
    height: get(/Height:\s*(\d+)/),
    spo2:   get(/SpO₂:\s*(\d+)/),
    other:  str?.replace(/BP:[\s\d/]+mmHg,?\s*/,'')
               .replace(/Temp:[\s\d.]+°C,?\s*/,'')
               .replace(/Pulse:[\s\d]+bpm,?\s*/,'')
               .replace(/Weight:[\s\d.]+kg,?\s*/,'')
               .replace(/Height:[\s\d]+cm,?\s*/,'')
               .replace(/SpO₂:[\s\d]+%,?\s*/,'').trim() || ''
  };
}

function fmt12h(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`;
}
function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('en-GH', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────
if (document.getElementById('loginForm')) {
  document.getElementById('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const name = document.getElementById('staffName').value.trim();
    const code = document.getElementById('passcode').value.trim();
    const errEl = document.getElementById('loginError');

    if (code !== PASSCODE) {
      errEl.classList.remove('hidden');
      return;
    }
    errEl.classList.add('hidden');

    // Register session with backend
    let sessionId = null;
    try {
      const res = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffName: name })
      });
      const data = await res.json();
      sessionId = data.sessionId;
    } catch {
      // Backend unavailable — continue without live sessions
    }

    saveSession({ staffName: name, loginTime: new Date().toISOString(), sessionId, activity: [] });
    logActivity('Logged in to the portal');
    window.location.href = 'dashboard.html';
  });
}

// ─── DASHBOARD PAGE ─────────────────────────────────────────────────────────
if (document.body.classList.contains('dashboard-page')) {
  const session = getSession();
  if (!session) { window.location.href = 'index.html'; }

  document.getElementById('sidebarStaffName').textContent = session.staffName;
  document.getElementById('headerStaffName').textContent = session.staffName;
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('en-GH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // ── WebSocket for live sessions ──────────────────────────────────────────
  let ws;
  function connectWS() {
    setWsStatus('connecting');
    ws = new WebSocket(WS_URL);
    ws.onopen = () => setWsStatus('connected');
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'sessions_update') applySessionsUpdate(data);
    };
    ws.onclose = () => { setWsStatus('disconnected'); setTimeout(connectWS, 3000); };
  }
  connectWS();

  // ── Navigation ──────────────────────────────────────────────────────────
  const sections = {
    records: 'Patient Records', add: 'Add New Record',
    activity: 'Activity Log', sessions: 'Staff Sessions'
  };
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.section;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.section').forEach(s => {
        s.classList.add('hidden'); s.classList.remove('active');
      });
      const sec = document.getElementById('section-' + target);
      sec.classList.remove('hidden'); sec.classList.add('active');
      document.getElementById('sectionTitle').textContent = sections[target];
      if (target === 'records') renderTable();
      if (target === 'activity') renderActivity();
      if (target === 'add') resetForm();
      if (target === 'sessions') fetchAndRenderSessions();
    });
  });

  // ── Logout ───────────────────────────────────────────────────────────────
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    logActivity('Logged out of the portal');
    if (session?.sessionId) {
      try {
        await fetch(`${API}/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.sessionId })
        });
      } catch { /* backend unavailable */ }
    }
    if (ws) ws.close();
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = 'index.html';
  });

  // ── Records Table ────────────────────────────────────────────────────────
  function renderTable(filter = '') {
    const records = getRecords();
    const tbody = document.getElementById('recordsBody');
    const noRec = document.getElementById('noRecords');
    const q = filter.toLowerCase();
    const filtered = records.filter(r =>
      r.name.toLowerCase().includes(q) || r.studentId.toLowerCase().includes(q)
    );
    tbody.innerHTML = '';
    if (filtered.length === 0) { noRec.classList.remove('hidden'); return; }
    noRec.classList.add('hidden');
    filtered.forEach((r) => {
      const realIndex = records.indexOf(r);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.name}</td>
        <td>${r.studentId}</td>
        <td>${formatDate(r.date)}</td>
        <td>${fmt12h(r.time)}</td>
        <td>${r.staff}</td>
        <td class="vitals-cell">${r.vitals || '—'}</td>
        <td class="medicine-cell">${r.medicine || '—'}</td>
        <td>₵${parseFloat(r.bill || 0).toLocaleString('en-GH', { minimumFractionDigits: 2 })}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-sm btn-view" onclick="viewRecord(${realIndex})">View</button>
          <button class="btn btn-sm btn-edit" onclick="editRecord(${realIndex})" style="margin:0 4px">Edit</button>
          <button class="btn btn-sm btn-delete" onclick="deleteRecord(${realIndex})">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  document.getElementById('searchInput').addEventListener('input', function () {
    renderTable(this.value);
  });
  renderTable();

  // ── Add / Edit Form ──────────────────────────────────────────────────────
  function resetForm() {
    document.getElementById('editIndex').value = '';
    document.getElementById('formTitle').textContent = 'New Patient Record';
    ['f_name','f_id','f_vitals_other','f_medicine'].forEach(id => document.getElementById(id).value = '');
    ['f_bp_sys','f_bp_dia','f_temp','f_pulse','f_weight','f_height','f_spo2'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('f_date').value = todayISO();
    document.getElementById('f_time').value = nowTime();
    document.getElementById('f_staff').value = session.staffName;
    document.getElementById('f_bill').value = '';
    document.getElementById('formMsg').classList.add('hidden');
  }

  document.getElementById('saveRecordBtn').addEventListener('click', () => {
    const name     = document.getElementById('f_name').value.trim();
    const id       = document.getElementById('f_id').value.trim();
    const date     = document.getElementById('f_date').value;
    const time     = document.getElementById('f_time').value;
    const staff    = document.getElementById('f_staff').value.trim();
    const vitals   = buildVitals();
    const medicine = document.getElementById('f_medicine').value.trim();
    const bill     = document.getElementById('f_bill').value;
    const msgEl    = document.getElementById('formMsg');

    if (!name || !id || !date || !staff) {
      msgEl.textContent = 'Please fill in all required fields.';
      msgEl.style.cssText = 'color:#e53e3e;background:#fff5f5;border-color:#fed7d7';
      msgEl.classList.remove('hidden'); return;
    }

    const records = getRecords();
    const editIdx = document.getElementById('editIndex').value;
    const record  = { name, studentId: id, date, time, staff, vitals, medicine, bill };

    if (editIdx !== '') {
      records[parseInt(editIdx)] = record;
      logActivity(`Edited record for ${name} (ID: ${id})`);
      msgEl.textContent = 'Record updated successfully.';
    } else {
      records.push(record);
      logActivity(`Added new record for ${name} (ID: ${id})`);
      msgEl.textContent = 'Record saved successfully.';
    }

    saveRecords(records);
    msgEl.style.cssText = '';
    msgEl.classList.remove('hidden');
    setTimeout(() => msgEl.classList.add('hidden'), 3000);
    resetForm();
  });

  document.getElementById('cancelEditBtn').addEventListener('click', () => {
    resetForm();
    document.querySelector('[data-section="records"]').click();
  });

  // ── View Modal ───────────────────────────────────────────────────────────
  window.viewRecord = function (index) {
    const r = getRecords()[index];
    if (!r) return;
    const modal = document.getElementById('viewModal');
    document.getElementById('modalBody').innerHTML = `
      <div class="modal-row"><span class="modal-label">Student Name</span><span class="modal-value">${r.name}</span></div>
      <div class="modal-row"><span class="modal-label">Student ID</span><span class="modal-value">${r.studentId}</span></div>
      <div class="modal-row"><span class="modal-label">Visit Date</span><span class="modal-value">${formatDate(r.date)}</span></div>
      <div class="modal-row"><span class="modal-label">Visit Time</span><span class="modal-value">${fmt12h(r.time)}</span></div>
      <div class="modal-row"><span class="modal-label">Attended By</span><span class="modal-value">${r.staff}</span></div>
      <div class="modal-row"><span class="modal-label">Vitals</span><span class="modal-value">${r.vitals || '—'}</span></div>
      <div class="modal-row"><span class="modal-label">Medicine Prescribed</span><span class="modal-value">${r.medicine || '—'}</span></div>
      <div class="modal-row"><span class="modal-label">Bill Paid</span><span class="modal-value">₵${parseFloat(r.bill || 0).toLocaleString('en-GH', { minimumFractionDigits: 2 })}</span></div>`;
    modal.classList.remove('hidden');
    logActivity(`Viewed record for ${r.name} (ID: ${r.studentId})`);
  };

  document.getElementById('closeModal').addEventListener('click', () => {
    document.getElementById('viewModal').classList.add('hidden');
  });
  document.getElementById('viewModal').addEventListener('click', function (e) {
    if (e.target === this) this.classList.add('hidden');
  });

  // ── Edit ─────────────────────────────────────────────────────────────────
  window.editRecord = function (index) {
    const r = getRecords()[index];
    if (!r) return;
    document.getElementById('editIndex').value = index;
    document.getElementById('formTitle').textContent = 'Edit Patient Record';
    document.getElementById('f_name').value     = r.name;
    document.getElementById('f_id').value       = r.studentId;
    document.getElementById('f_date').value     = r.date;
    document.getElementById('f_time').value     = r.time || '';
    document.getElementById('f_staff').value    = r.staff;
    const v = parseVitals(r.vitals || '');
    document.getElementById('f_bp_sys').value      = v.sys;
    document.getElementById('f_bp_dia').value      = v.dia;
    document.getElementById('f_temp').value        = v.temp;
    document.getElementById('f_pulse').value       = v.pulse;
    document.getElementById('f_weight').value      = v.weight;
    document.getElementById('f_height').value      = v.height;
    document.getElementById('f_spo2').value        = v.spo2;
    document.getElementById('f_vitals_other').value = v.other;
    document.getElementById('f_medicine').value = r.medicine;
    document.getElementById('f_bill').value     = r.bill;
    document.querySelector('[data-section="add"]').click();
  };

  // ── Delete ───────────────────────────────────────────────────────────────
  window.deleteRecord = function (index) {
    const records = getRecords();
    const r = records[index];
    if (!r) return;
    if (!confirm(`Delete record for ${r.name} (${r.studentId})?`)) return;
    records.splice(index, 1);
    saveRecords(records);
    logActivity(`Deleted record for ${r.name} (ID: ${r.studentId})`);
    renderTable(document.getElementById('searchInput').value);
  };

  // ── Activity Log ─────────────────────────────────────────────────────────
  function renderActivity() {
    const list = document.getElementById('activityList');
    const noAct = document.getElementById('noActivity');
    const acts = getSession()?.activity || [];
    list.innerHTML = '';
    if (acts.length === 0) { noAct.classList.remove('hidden'); return; }
    noAct.classList.add('hidden');
    acts.slice().reverse().forEach(a => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="act-time">${a.time}</span><span class="act-text">${a.action}</span>`;
      list.appendChild(li);
    });
  }

  // ── Staff Sessions ────────────────────────────────────────────────────────
  let _lastActive = [];
  let _durationTimer = null;

  function showToast(msg, type = 'toast-join') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${type === 'toast-join' ? '🟢' : '🔴'}</span> ${msg}`;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  function setWsStatus(state) {
    const el = document.getElementById('wsStatus');
    if (!el) return;
    el.className = `ws-status ${state}`;
    const labels = { connected: 'Live', disconnected: 'Disconnected', connecting: 'Connecting...' };
    el.querySelector('.ws-label').textContent = labels[state] || state;
  }

  function elapsedStr(isoStart) {
    const secs = Math.floor((Date.now() - new Date(isoStart)) / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m online`;
    if (m > 0) return `${m}m ${s}s online`;
    return `${s}s online`;
  }

  function durationStr(loginIso, logoutIso) {
    const secs = Math.floor((new Date(logoutIso) - new Date(loginIso)) / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function initials(name) {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  function tickDurations() {
    _lastActive.forEach(e => {
      const el = document.getElementById(`dur-${e.sessionId}`);
      if (el) el.textContent = elapsedStr(e.loginTime);
    });
  }

  async function fetchAndRenderSessions() {
    try {
      const res = await fetch(`${API}/sessions`);
      const data = await res.json();
      applySessionsUpdate(data);
    } catch {
      const el = document.getElementById('noActiveSessions');
      if (el) { el.textContent = 'Could not reach server.'; el.classList.remove('hidden'); }
    }
  }

  function applySessionsUpdate({ active, past }) {
    // Toast diffs
    const prevIds = new Set(_lastActive.map(e => e.sessionId));
    const newIds  = new Set(active.map(e => e.sessionId));
    active.forEach(e => { if (!prevIds.has(e.sessionId)) showToast(`${e.staffName} logged in`, 'toast-join'); });
    _lastActive.forEach(e => { if (!newIds.has(e.sessionId)) showToast(`${e.staffName} logged out`, 'toast-leave'); });
    _lastActive = active;

    // WS badge on nav
    const navBtn = document.querySelector('[data-section="sessions"]');
    if (navBtn) navBtn.textContent = `👥 Staff Sessions${active.length ? ` (${active.length})` : ''}`;

    // Stats
    const today = new Date().toDateString();
    const todaySessions = [...active, ...past].filter(e => new Date(e.loginTime).toDateString() === today);
    const statOnline = document.getElementById('statOnline');
    const statToday  = document.getElementById('statToday');
    const statTotal  = document.getElementById('statTotal');
    if (statOnline) statOnline.textContent = active.length;
    if (statToday)  statToday.textContent  = todaySessions.length;
    if (statTotal)  statTotal.textContent  = active.length + past.length;

    // Active list
    const activeEl   = document.getElementById('activeSessions');
    const noActiveEl = document.getElementById('noActiveSessions');
    if (activeEl) {
      activeEl.innerHTML = '';
      if (active.length === 0) {
        noActiveEl.classList.remove('hidden');
      } else {
        noActiveEl.classList.add('hidden');
        active.forEach(e => {
          const li = document.createElement('li');
          li.className = 'session-item session-active';
          li.innerHTML = `
            <div class="session-avatar">${initials(e.staffName)}</div>
            <div class="session-info">
              <div class="session-name">${e.staffName}</div>
              <div class="session-time">Logged in: ${fmtDateTime(e.loginTime)}</div>
            </div>
            <span class="session-duration" id="dur-${e.sessionId}">${elapsedStr(e.loginTime)}</span>`;
          activeEl.appendChild(li);
        });
      }
    }

    // Past list
    const pastEl   = document.getElementById('pastSessions');
    const noPastEl = document.getElementById('noPastSessions');
    if (pastEl) {
      pastEl.innerHTML = '';
      if (past.length === 0) {
        noPastEl.classList.remove('hidden');
      } else {
        noPastEl.classList.add('hidden');
        past.forEach(e => {
          const li = document.createElement('li');
          li.className = 'session-item session-past';
          li.innerHTML = `
            <div class="session-avatar">${initials(e.staffName)}</div>
            <div class="session-info">
              <div class="session-name">${e.staffName}</div>
              <div class="session-time">In: ${fmtDateTime(e.loginTime)} &nbsp;|&nbsp; Out: ${fmtDateTime(e.logoutTime)}</div>
            </div>
            <span class="session-duration">${durationStr(e.loginTime, e.logoutTime)}</span>`;
          pastEl.appendChild(li);
        });
      }
    }

    // Start live duration ticker
    if (_durationTimer) clearInterval(_durationTimer);
    if (active.length > 0) _durationTimer = setInterval(tickDurations, 1000);
  }
}
