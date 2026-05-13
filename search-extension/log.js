let allLogs = [];
let activeId = null;

const logListEl  = document.getElementById('logList');
const detailEl   = document.getElementById('detail');
const countBadge = document.getElementById('countBadge');

async function loadLogs() {
  allLogs = await Logger.getAll();
  renderList();
  if (activeId) {
    const entry = allLogs.find(l => l.id === activeId);
    if (entry) renderDetail(entry);
  }
  countBadge.textContent = `${allLogs.length} entr${allLogs.length === 1 ? 'y' : 'ies'}`;
}

function renderList() {
  if (!allLogs.length) {
    logListEl.innerHTML = `<div class="empty-list">No API calls logged yet.<br>Run a search to see activity here.</div>`;
    return;
  }
  logListEl.innerHTML = allLogs.map(entry => {
    const actionShort = entry.action.replace('http://bvdep.com/webservices/', '');
    const ts = new Date(entry.timestamp);
    const timeStr = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = ts.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const isOk = !entry.error && entry.status && entry.status < 400;
    const dotClass = entry.pending ? 'pending' : isOk ? 'ok' : 'err';
    const statusText = entry.pending ? 'pending…' : entry.error ? 'error' : `HTTP ${entry.status}`;
    const statusClass = entry.pending ? '' : isOk ? 'ok' : 'err';
    const active = entry.id === activeId ? ' active' : '';
    return `<div class="log-entry${active}" data-id="${entry.id}">
      <div class="entry-top"><div class="status-dot ${dotClass}"></div><div class="entry-action"><span class="action-name">${escHtml(actionShort)}</span></div></div>
      <div class="entry-meta"><span class="entry-time">${dateStr} ${timeStr}</span>${entry.durationMs !== null ? `<span class="entry-duration">${entry.durationMs}ms</span>` : ''}<span class="entry-status ${statusClass}">${statusText}</span></div>
    </div>`;
  }).join('');
  logListEl.querySelectorAll('.log-entry').forEach(el => {
    el.addEventListener('click', () => {
      activeId = el.dataset.id;
      logListEl.querySelectorAll('.log-entry').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      const entry = allLogs.find(l => l.id === activeId);
      if (entry) renderDetail(entry);
    });
  });
}

function renderDetail(entry) {
  const actionShort = entry.action.replace('http://bvdep.com/webservices/', '');
  const ts = new Date(entry.timestamp).toLocaleString();
  const isOk = !entry.error && entry.status && entry.status < 400;
  const statusPill = entry.pending ? `<span class="pill">pending</span>` : isOk ? `<span class="pill ok">HTTP ${entry.status} OK</span>` : `<span class="pill err">${entry.error ? 'Error: ' + escHtml(entry.error) : 'HTTP ' + entry.status}</span>`;
  detailEl.innerHTML = `
    <div class="detail-header">
      <div class="detail-title"><span class="action-name">${escHtml(actionShort)}</span></div>
      <div class="detail-pills">${statusPill}${entry.durationMs !== null ? `<span class="pill">${entry.durationMs}ms</span>` : ''}<span class="pill">${escHtml(ts)}</span><span class="pill" title="${escHtml(entry.url)}">${escHtml(trimUrl(entry.url))}</span></div>
    </div>
    <div class="section"><div class="section-label">Action <button class="copy-btn" data-copy="${escHtml(entry.action)}">copy</button></div><pre>${escHtml(entry.action)}</pre></div>
    <div class="section"><div class="section-label">Request Body <button class="copy-btn" data-copy-pre="req">copy</button></div><pre id="pre-req">${highlightXml(entry.requestBody || '')}</pre></div>
    <div class="section"><div class="section-label">Response Body <button class="copy-btn" data-copy-pre="res">copy</button></div><pre id="pre-res">${entry.responseBody ? highlightXml(entry.responseBody) : entry.pending ? '(pending…)' : '(empty response body)'}</pre></div>
    ${entry.error ? `<div class="section"><div class="section-label">Error</div><pre style="color:var(--danger)">${escHtml(entry.error)}</pre></div>` : ''}`;
  detailEl.querySelectorAll('.copy-btn[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => { navigator.clipboard.writeText(btn.dataset.copy); btn.textContent = 'copied!'; setTimeout(() => btn.textContent = 'copy', 1500); });
  });
  detailEl.querySelectorAll('.copy-btn[data-copy-pre]').forEach(btn => {
    btn.addEventListener('click', () => { const pre = document.getElementById('pre-' + btn.dataset.copyPre); navigator.clipboard.writeText(pre.innerText); btn.textContent = 'copied!'; setTimeout(() => btn.textContent = 'copy', 1500); });
  });
}

document.getElementById('refreshBtn').addEventListener('click', loadLogs);
document.getElementById('clearBtn').addEventListener('click', async () => {
  if (!confirm('Clear all API logs?')) return;
  await Logger.clear();
  allLogs = []; activeId = null;
  detailEl.innerHTML = `<div class="detail-empty"><div class="icon">📋</div><span>Select an entry to view details</span></div>`;
  renderList();
  countBadge.textContent = '0 entries';
});

setInterval(() => { if (!document.hidden) loadLogs(); }, 3000);

function trimUrl(url) { try { const u = new URL(url); return u.hostname + u.pathname; } catch { return url; } }
function escHtml(str) { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function highlightXml(xml) {
  if (!xml) return '';
  return escHtml(xml)
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="xml-comment">$1</span>')
    .replace(/(&lt;\/?)(\w[\w:.-]*)([^&]*?)(\/? &gt;)/g, (_, open, name, attrs, close) => {
      const ha = attrs.replace(/([\w:-]+)(=)(&quot;[^&]*?&quot;)/g, '<span class="xml-attr">$1</span>$2<span class="xml-val">$3</span>');
      return `<span class="xml-tag">${open}${name}</span>${ha}<span class="xml-tag">${close}</span>`;
    });
}

loadLogs();
