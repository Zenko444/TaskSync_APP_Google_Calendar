// ── Config ─────────────────────────────────────────────
const CLIENT_ID     = 'REPLACE ME'; // Get from Google Cloud Console
const BACKEND_URL   = 'http://localhost:3000';
const CALENDAR_ID   = 'primary';
const AUTO_DELETE_DAYS = 30;
const APP_TAG       = 'tasksync-app';

// ── State ──────────────────────────────────────────────
let accessToken    = null;
let tokenClient    = null;
let currentUser    = null;
let editingEventId = null;

// ── Helpers: wait for Google GSI to load ───────────────
function waitForGoogle(callback, retries = 50) {
  if (typeof google !== 'undefined' && google.accounts?.oauth2) {
    callback();
  } else if (retries > 0) {
    setTimeout(() => waitForGoogle(callback, retries - 1), 100);
  } else {
    showToast('Failed to load Google Sign-In library.', 'error');
  }
}

function initGoogleClient() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email',
    callback: onGoogleToken
  });
}

// ── Auth flow ──────────────────────────────────────────
async function onGoogleToken(resp) {
  if (resp.error) {
    showToast('Google auth error: ' + resp.error, 'error');
    return;
  }

  accessToken = resp.access_token;

  // Verify with our backend — checks whitelist in db.json
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken })
    });

    const data = await res.json();

    if (!res.ok || !data.allowed) {
      accessToken = null;
      showAccessDenied(data.error || 'Access denied.');
      return;
    }

    // Allowed — update UI
    currentUser = data.user;
    setConnected(true);
    loadTasks();

  } catch (err) {
    showToast('Could not reach backend. Is the server running?', 'error');
    accessToken = null;
  }
}

function handleAuth() {
  if (accessToken) {
    // Sign out
    google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null;
    currentUser = null;
    setConnected(false);
    document.getElementById('task-list').innerHTML = `
      <div class="sign-in-prompt">
        <div class="icon">🔐</div>
        <h3>Sign in to see your tasks</h3>
        <p>Connect your Google account to sync tasks with Google Calendar.</p>
      </div>`;
  } else {
    waitForGoogle(() => {
      if (!tokenClient) initGoogleClient();
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }
}

function setConnected(on) {
  const btn = document.getElementById('auth-btn');
  document.getElementById('auth-icon').textContent  = on ? '✅' : '🔐';
  document.getElementById('auth-label').textContent = on ? 'Sign out' : 'Sign in with Google';
  btn.className = on ? 'connected' : '';

  const chip = document.getElementById('user-chip');
  if (on && currentUser) {
    document.getElementById('user-avatar').src  = currentUser.picture || '';
    document.getElementById('user-name').textContent = currentUser.name || currentUser.email;
    document.getElementById('user-role').textContent = currentUser.role || 'user';
    chip.classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
  }
}

function showAccessDenied(msg) {
  document.getElementById('task-list').innerHTML = `
    <div class="access-denied">
      <div class="icon">🚫</div>
      <h3>Access Denied</h3>
      <p>${escHtml(msg)}</p>
      <p style="margin-top:10px;font-size:0.78rem;">
        Contact the admin to add your email to the allowed list.
      </p>
    </div>`;
  setConnected(false);
  showToast(msg, 'error');
}

// ── Calendar API helpers ───────────────────────────────
async function calendarRequest(method, path, body) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Calendar API error');
  return data;
}

function makeEventBody(title, desc, start, end) {
  return {
    summary: title,
    description: `${desc || ''}\n\n[${APP_TAG}]`,
    start: { dateTime: new Date(start).toISOString() },
    end:   { dateTime: new Date(end).toISOString() },
    colorId: '9',
    reminders: {
      useDefault: false, // Stop using default reminders
      overrides: [
        // Notification by popup if needed. You can adjust the method and timing as desired. 
        { method: 'popup', minutes: 60 }, 
        
        // Notification by email if needed. You can adjust the method and timing as desired. 
        //{ method: 'email', minutes: 60 } 
      ]
    }
  };
}

// ── CRUD ───────────────────────────────────────────────
async function submitTask() {
  if (!accessToken) { showToast('Please sign in first', 'error'); return; }

  const title = document.getElementById('task-title').value.trim();
  const desc  = document.getElementById('task-desc').value.trim();
  const start = document.getElementById('task-start').value;
  const end   = document.getElementById('task-end').value;

  if (!title || !start || !end) {
    showToast('Title, start, and end time are required', 'error'); return;
  }
  if (new Date(end) <= new Date(start)) {
    showToast('End time must be after start time', 'error'); return;
  }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving...';

  try {
    const body = makeEventBody(title, desc, start, end);
    if (editingEventId) {
      await calendarRequest('PUT', `/calendars/${CALENDAR_ID}/events/${editingEventId}`, body);
      showToast('✅ Task updated in Google Calendar', 'success');
      cancelEdit();
    } else {
      await calendarRequest('POST', `/calendars/${CALENDAR_ID}/events`, body);
      showToast('✅ Task added to Google Calendar', 'success');
      clearForm();
    }
    await loadTasks();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>📅</span> <span id="submit-label">${editingEventId ? 'Update Task' : 'Add to Calendar'}</span>`;
  }
}

async function removeTask(eventId) {
  if (!confirm('Remove this task from Google Calendar?')) return;
  try {
    await calendarRequest('DELETE', `/calendars/${CALENDAR_ID}/events/${eventId}`);
    showToast('🗑️ Task removed from Google Calendar', 'info');
    await loadTasks();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

function startEdit(event) {
  editingEventId = event.id;
  document.getElementById('task-title').value      = event.summary || '';
  document.getElementById('task-desc').value       = (event.description || '').replace(/\n?\n?\[tasksync-app\]/, '').trim();
  document.getElementById('task-start').value      = toLocalDatetimeInput(new Date(event.start.dateTime));
  document.getElementById('task-end').value        = toLocalDatetimeInput(new Date(event.end.dateTime));
  document.getElementById('form-mode-label').textContent = '✏️ Editing Task';
  document.getElementById('submit-label').textContent    = 'Update Task';
  document.getElementById('cancel-edit-btn').style.display = 'inline-flex';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
  editingEventId = null;
  document.getElementById('form-mode-label').textContent        = '➕ New Task';
  document.getElementById('submit-label').textContent           = 'Add to Calendar';
  document.getElementById('cancel-edit-btn').style.display      = 'none';
  clearForm();
}

// ── Load & auto-delete ─────────────────────────────────
async function loadTasks() {
  if (!accessToken) return;

  const list = document.getElementById('task-list');
  list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted)"><span class="spinner"></span></div>';

  try {
    const timeMin = new Date(Date.now() - 90 * 86400000).toISOString();
    const timeMax = new Date(Date.now() + 365 * 86400000).toISOString();
    const data = await calendarRequest('GET',
      `/calendars/${CALENDAR_ID}/events?maxResults=250&singleEvents=true&orderBy=startTime&timeMin=${timeMin}&timeMax=${timeMax}`
    );

    // Filter to TaskSync events only
    let events = (data.items || []).filter(e =>
      e.description?.includes(`[${APP_TAG}]`)
    );

    // Auto-delete events older than AUTO_DELETE_DAYS past their end
    const cutoff  = Date.now() - AUTO_DELETE_DAYS * 86400000;
    const toDelete = events.filter(e => {
      const end = new Date(e.end?.dateTime || e.end?.date).getTime();
      return end < cutoff;
    });

    if (toDelete.length > 0) {
      await Promise.all(
        toDelete.map(e =>
          calendarRequest('DELETE', `/calendars/${CALENDAR_ID}/events/${e.id}`).catch(() => {})
        )
      );
      events = events.filter(e => !toDelete.find(d => d.id === e.id));
      showToast(`🧹 Auto-deleted ${toDelete.length} expired task(s)`, 'info');
    }

    if (events.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="icon">📭</div>
          <p>No tasks yet — add your first task above!</p>
        </div>`;
      return;
    }

    const now = Date.now();
    list.innerHTML = events.map(e => {
      const startDate = new Date(e.start?.dateTime || e.start?.date);
      const endDate   = new Date(e.end?.dateTime   || e.end?.date);
      const isPast    = endDate.getTime() < now;
      const desc      = (e.description || '').replace(/\n?\n?\[tasksync-app\]/, '').trim();
      const fmt = d => d.toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });

      return `
        <div class="task-item${isPast ? ' past' : ''}">
          <div class="task-body">
            <div class="task-title">${escHtml(e.summary || 'Untitled')}</div>
            ${desc ? `<div class="task-desc">${escHtml(desc)}</div>` : ''}
            <div class="task-meta">
              <span class="tag ${isPast ? 'tag-past' : 'tag-time'}">
                ${isPast ? '⏰ Past · ' : '📅 '}${fmt(startDate)} → ${fmt(endDate)}
              </span>
              ${isPast ? `<span class="tag tag-past">🗑 Auto-deletes ${formatAutoDelete(endDate)}</span>` : ''}
            </div>
          </div>
          <div class="task-actions">
            <button class="btn-edit" onclick='startEdit(${JSON.stringify(e).replace(/'/g, "&#39;")})'>Edit</button>
            <button class="btn-remove" onclick="removeTask('${e.id}')">Remove</button>
          </div>
        </div>`;
    }).join('');

  } catch (e) {
    list.innerHTML = `<div class="empty-state"><p style="color:var(--danger)">Error: ${escHtml(e.message)}</p></div>`;
  }
}

// ── Utilities ──────────────────────────────────────────
function toLocalDatetimeInput(d) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 16);
}

function clearForm() {
  document.getElementById('task-title').value = '';
  document.getElementById('task-desc').value  = '';
  const now   = new Date();
  const later = new Date(now.getTime() + 60 * 60 * 1000);
  document.getElementById('task-start').value = toLocalDatetimeInput(now);
  document.getElementById('task-end').value   = toLocalDatetimeInput(later);
}

function formatAutoDelete(endDate) {
  const deleteAt = new Date(endDate.getTime() + AUTO_DELETE_DAYS * 86400000);
  const days = Math.ceil((deleteAt - Date.now()) / 86400000);
  if (days <= 0) return 'soon';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let toastTimer;
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3500);
}

// ── Init ───────────────────────────────────────────────
window.onload = () => {
  clearForm();
  waitForGoogle(initGoogleClient);
};
