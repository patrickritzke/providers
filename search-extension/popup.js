const DEFAULT_MOODYS_URL = 'https://webservices.bvdinfo.com/v1.3/orbis4/remoteaccess.asmx';
const DNB_TOKEN_URL      = 'https://plus.dnb.com/v2/token';
const DNB_SEARCH_URL     = 'https://plus.dnb.com/v1/search/criteria';
const SP_AUTH_URL        = 'https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/authenticate/api/v1/token';
const SP_SEARCH_URL      = 'https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/v3/clientservice.json';
let PAGE_SIZE = 10;

let moodysCandidates = [], moodysPage = 1;
let dnbCandidates    = [], dnbPage    = 1;
let spCandidates     = [], spPage     = 1;
let squishyEnabled   = false;
let selectedProvider = 'all';
let configuredProviders = [];

const settingsBtn    = document.getElementById('settingsBtn');
const settingsPanel  = document.getElementById('settingsPanel');
const logBtn         = document.getElementById('logBtn');
const searchBtn      = document.getElementById('searchBtn');
const resultsWrapper = document.getElementById('resultsWrapper');
const toast          = document.getElementById('toast');
const tabBar         = document.getElementById('tabBar');
const noCredsMsg     = document.getElementById('noCredsMsg');
const nameInput      = document.getElementById('name');
const historyDropdown = document.getElementById('historyDropdown');
nameInput.focus();

const HISTORY_KEY = 'search_history';
const HISTORY_MAX = 10;

async function getHistory() {
  return new Promise(r => chrome.storage.local.get(HISTORY_KEY, d => r(d[HISTORY_KEY] || [])));
}
async function addToHistory(name) {
  let hist = await getHistory();
  hist = [name, ...hist.filter(h => h.toLowerCase() !== name.toLowerCase())].slice(0, HISTORY_MAX);
  chrome.storage.local.set({ [HISTORY_KEY]: hist });
}
async function removeFromHistory(name) {
  let hist = await getHistory();
  hist = hist.filter(h => h !== name);
  chrome.storage.local.set({ [HISTORY_KEY]: hist });
  renderHistory();
}
async function renderHistory(filter) {
  let hist = await getHistory();
  if (filter) hist = hist.filter(h => h.toLowerCase().includes(filter.toLowerCase()));
  if (!hist.length) { historyDropdown.classList.remove('open'); return; }
  historyDropdown.innerHTML = hist.map(h => `
    <div class="history-item" data-name="${h.replace(/"/g, '&quot;')}">
      <span class="hist-icon">↩</span>
      <span class="hist-name">${h}</span>
      <span class="hist-del" data-del="${h.replace(/"/g, '&quot;')}" title="Remove">×</span>
    </div>`).join('');
  historyDropdown.classList.add('open');
  historyDropdown.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.dataset.del) return;
      nameInput.value = el.dataset.name;
      historyDropdown.classList.remove('open');
      doSearch();
    });
  });
  historyDropdown.querySelectorAll('.hist-del').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); removeFromHistory(el.dataset.del); });
  });
}
nameInput.addEventListener('focus', () => renderHistory(nameInput.value));
nameInput.addEventListener('input', () => renderHistory(nameInput.value));
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') historyDropdown.classList.remove('open'); });
document.addEventListener('click', (e) => { if (!e.target.closest('.name-field')) historyDropdown.classList.remove('open'); });

logBtn.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('log.html') }));

settingsBtn.addEventListener('click', () => {
  const open = settingsPanel.classList.toggle('open');
  settingsBtn.classList.toggle('active', open);
  if (open) loadSettingsFields();
});
document.getElementById('noCredsSettingsLink').addEventListener('click', () => {
  settingsPanel.classList.add('open');
  settingsBtn.classList.add('active');
  loadSettingsFields();
  settingsPanel.scrollIntoView({ behavior: 'smooth' });
});

function loadSettingsFields() {
  chrome.storage.local.get(['moodys_username','moodys_password','moodys_base_url','dnb_basic_token','sp_username','sp_password'], s => {
    document.getElementById('moodysUser').value = s.moodys_username || '';
    document.getElementById('moodysPass').value = s.moodys_password || '';
    document.getElementById('moodysUrl').value  = s.moodys_base_url || '';
    document.getElementById('dnbToken').value   = s.dnb_basic_token || '';
    document.getElementById('spUser').value     = s.sp_username || '';
    document.getElementById('spPass').value     = s.sp_password || '';
    updateStatusDots(s);
  });
}
function updateStatusDots(s) {
  const dot = (id, val, cls) => { const el = document.getElementById(id); el.textContent = val ? '✓ Set' : 'Not set'; el.className = 'settings-status ' + (val ? cls : ''); };
  dot('moodys-status-dot', s.moodys_username && s.moodys_password, 'set');
  dot('dnb-status-dot', s.dnb_basic_token, 'dnb-set');
  dot('sp-status-dot', s.sp_username && s.sp_password, 'sp-set');
}

document.querySelectorAll('[data-provider]').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = btn.dataset.provider;
    let toSave = {};
    if (p === 'moodys') {
      const u = document.getElementById('moodysUser').value.trim();
      const pw = document.getElementById('moodysPass').value;
      const url = document.getElementById('moodysUrl').value.trim();
      if (!u || !pw) { flashMsg('moodys', 'Enter username and password', 'err'); return; }
      toSave = { moodys_username: u, moodys_password: pw, moodys_base_url: url };
    } else if (p === 'dnb') {
      const t = document.getElementById('dnbToken').value.trim();
      if (!t) { flashMsg('dnb', 'Enter Basic token', 'err'); return; }
      toSave = { dnb_basic_token: t };
    } else if (p === 'sp') {
      const u = document.getElementById('spUser').value.trim();
      const pw = document.getElementById('spPass').value;
      if (!u || !pw) { flashMsg('sp', 'Enter username and password', 'err'); return; }
      toSave = { sp_username: u, sp_password: pw };
    }
    chrome.storage.local.set(toSave, () => { flashMsg(p, '✓ Saved', 'ok'); refreshProviders(); });
  });
});
document.querySelectorAll('[data-clear]').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = btn.dataset.clear;
    const keys = p === 'moodys' ? ['moodys_username','moodys_password','moodys_base_url'] : p === 'dnb' ? ['dnb_basic_token'] : ['sp_username','sp_password'];
    chrome.storage.local.remove(keys, () => {
      if (p === 'moodys') { document.getElementById('moodysUser').value=''; document.getElementById('moodysPass').value=''; document.getElementById('moodysUrl').value=''; }
      if (p === 'dnb') { document.getElementById('dnbToken').value=''; }
      if (p === 'sp') { document.getElementById('spUser').value=''; document.getElementById('spPass').value=''; }
      flashMsg(p, 'Cleared', 'ok'); refreshProviders();
    });
  });
});
function flashMsg(p, msg, cls) {
  const el = document.getElementById('flash-' + p);
  el.textContent = msg; el.className = 'save-flash ' + cls;
  clearTimeout(el._t); el._t = setTimeout(() => el.className = 'save-flash', 2500);
  chrome.storage.local.get(['moodys_username','moodys_password','dnb_basic_token','sp_username','sp_password'], s => updateStatusDots(s));
}

function refreshProviders() {
  chrome.storage.local.get(['moodys_username','moodys_password','dnb_basic_token','sp_username','sp_password'], s => {
    configuredProviders = [];
    if (s.moodys_username && s.moodys_password) configuredProviders.push('moodys');
    if (s.dnb_basic_token)                      configuredProviders.push('dnb');
    if (s.sp_username && s.sp_password)         configuredProviders.push('sp');
    buildProviderSelector(); updateStatusDots(s);
  });
}
function buildProviderSelector() {
  const sel = document.getElementById('providerSelector');
  const row = document.getElementById('providerRow');
  if (configuredProviders.length === 0) { row.style.display = 'none'; noCredsMsg.style.display = 'block'; searchBtn.disabled = true; return; }
  searchBtn.disabled = false; noCredsMsg.style.display = 'none'; row.style.display = 'block';
  const labels = { moodys: "Moody's", dnb: 'D&B', sp: 'S&P' };
  let html = '';
  if (configuredProviders.length > 1) html += `<div class="provider-opt sel-all" data-v="all">All</div>`;
  configuredProviders.forEach(p => { html += `<div class="provider-opt" data-v="${p}">${labels[p]}</div>`; });
  sel.innerHTML = html;
  if (configuredProviders.length === 1) { selectedProvider = configuredProviders[0]; row.style.display = 'none'; }
  else { selectedProvider = 'all'; sel.querySelector('[data-v="all"]').classList.add('sel-all'); }
  sel.querySelectorAll('.provider-opt').forEach(o => {
    o.addEventListener('click', () => {
      sel.querySelectorAll('.provider-opt').forEach(x => x.className = 'provider-opt');
      const cls = { all:'sel-all', moodys:'sel-moodys', dnb:'sel-dnb', sp:'sel-sp' }[o.dataset.v];
      o.classList.add(cls); selectedProvider = o.dataset.v;
    });
  });
}

function buildTabs(providers) {
  const multi = providers.length > 1;
  let html = '';
  if (multi) html += `<div class="tab matched active" data-tab="matched">All <span class="tab-count" id="matchedCount">—</span></div>`;
  const cfg = { moodys: ["Moody's", ''], dnb: ['D&amp;B', 'dnb'], sp: ['S&amp;P', 'sp'] };
  providers.forEach(p => { const [label, cls] = cfg[p]; html += `<div class="tab ${cls}" data-tab="${p}">${label} <span class="tab-count" id="${p}Count">—</span></div>`; });
  tabBar.innerHTML = html;
  if (!multi) { document.getElementById('panelMatched').classList.remove('active'); document.getElementById(`panel${cap(providers[0])}`).classList.add('active'); }
  else { document.getElementById('panelMatched').classList.add('active'); }
  tabBar.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]'); if (!tab) return;
    tabBar.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panelId = tab.dataset.tab === 'matched' ? 'panelMatched' : `panel${cap(tab.dataset.tab)}`;
    document.getElementById(panelId).classList.add('active');
  });
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

document.getElementById('pagesizeOpts').addEventListener('click', e => {
  const btn = e.target.closest('.pagesize-btn'); if (!btn) return;
  PAGE_SIZE = parseInt(btn.dataset.size);
  document.querySelectorAll('.pagesize-btn').forEach(b => b.classList.toggle('active', b === btn));
  moodysPage = 1; dnbPage = 1; spPage = 1;
  if (moodysCandidates.length) renderProviderPage('moodys');
  if (dnbCandidates.length)    renderProviderPage('dnb');
  if (spCandidates.length)     renderProviderPage('sp');
});
document.getElementById('squishyToggle').addEventListener('change', e => {
  squishyEnabled = e.target.checked;
  if (moodysCandidates.length || dnbCandidates.length || spCandidates.length) renderMatched();
});

searchBtn.addEventListener('click', doSearch);
document.getElementById('name').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

async function doSearch() {
  const name = document.getElementById('name').value.trim();
  if (!name) { alert('Please enter a company name.'); return; }
  const providers = selectedProvider === 'all' ? configuredProviders : [selectedProvider];
  const multi = providers.length > 1;
  searchBtn.disabled = true; searchBtn.innerHTML = '<span class="spinner"></span>Searching…';
  historyDropdown.classList.remove('open');
  addToHistory(name);
  resultsWrapper.style.display = 'block';
  moodysCandidates = []; dnbCandidates = []; spCandidates = []; moodysPage = 1; dnbPage = 1; spPage = 1;
  ['moodysBody','dnbBody','spBody','matchedBody'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = `<div class="panel-loading"><span class="spinner"></span>Loading…</div>`; });
  ['moodys-pagination','dnb-pagination','sp-pagination'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
  buildTabs(providers);
  chrome.storage.local.get(['moodys_username','moodys_password','moodys_base_url','dnb_basic_token','sp_username','sp_password'], async s => {
    const tasks = {
      moodys: providers.includes('moodys') ? runMoodys(s, name) : null,
      dnb:    providers.includes('dnb')    ? runDnb(s, name)    : null,
      sp:     providers.includes('sp')     ? runSp(s, name)     : null,
    };
    const results = {};
    await Promise.all(Object.entries(tasks).map(async ([p, task]) => {
      if (!task) return;
      try { results[p] = { ok: true, data: await task }; } catch(e) { results[p] = { ok: false, err: e.message }; }
    }));
    if (results.moodys) {
      if (results.moodys.ok) { moodysCandidates = results.moodys.data; setCount('moodys', moodysCandidates.length); renderProviderPage('moodys'); }
      else { setCount('moodys', '!'); document.getElementById('moodysBody').innerHTML = `<div class="status error">⚠ ${escHtml(results.moodys.err)}</div>`; }
    }
    if (results.dnb) {
      if (results.dnb.ok) { dnbCandidates = results.dnb.data; setCount('dnb', dnbCandidates.length); renderProviderPage('dnb'); }
      else { setCount('dnb', '!'); document.getElementById('dnbBody').innerHTML = `<div class="status error">⚠ ${escHtml(results.dnb.err)}</div>`; }
    }
    if (results.sp) {
      if (results.sp.ok) { spCandidates = results.sp.data; setCount('sp', spCandidates.length); renderProviderPage('sp'); }
      else { setCount('sp', '!'); document.getElementById('spBody').innerHTML = `<div class="status error">⚠ ${escHtml(results.sp.err)}</div>`; }
    }
    if (multi) renderMatched();
    searchBtn.disabled = false; searchBtn.textContent = 'Search';
  });
}
function setCount(p, n) { const el = document.getElementById(p + 'Count'); if (el) el.textContent = n; }

function escXml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
function buildOpenEnv(u, p) {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://bvdep.com/webservices/"><soapenv:Header/><soapenv:Body><web:Open><web:username>${escXml(u)}</web:username><web:password>${escXml(p)}</web:password></web:Open></soapenv:Body></soapenv:Envelope>`;
}
function buildMatchEnv(sid, name) {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://bvdep.com/webservices/"><soapenv:Header/><soapenv:Body><web:Match><web:sessionHandle>${escXml(sid)}</web:sessionHandle><web:criteria><web:Name>${escXml(name)}</web:Name><web:Address></web:Address><web:PostCode></web:PostCode><web:City></web:City><web:Country></web:Country><web:PhoneOrFax></web:PhoneOrFax><web:EMailOrWebsite></web:EMailOrWebsite><web:NationalId></web:NationalId><web:Ticker></web:Ticker><web:Isin></web:Isin><web:State></web:State><web:BvD9></web:BvD9></web:criteria><web:exclusionFlags></web:exclusionFlags></web:Match></soapenv:Body></soapenv:Envelope>`;
}
function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

async function runMoodys(s, name) {
  const u = s.moodys_username, pw = s.moodys_password;
  const baseUrl = s.moodys_base_url || DEFAULT_MOODYS_URL;
  const openXml = await Logger.trackedSoapCall(baseUrl, 'http://bvdep.com/webservices/Open', buildOpenEnv(u, pw));
  const sid = xmlTag(openXml, 'OpenResult');
  if (!sid) throw new Error(xmlTag(openXml, 'faultstring') || "Moody's: no session ID");
  const matchXml = await Logger.trackedSoapCall(baseUrl, 'http://bvdep.com/webservices/Match', buildMatchEnv(sid, name));
  const out = [];
  const re = /<(?:[^:>]+:)?MatchResult[^>]*>([\s\S]*?)<\/(?:[^:>]+:)?MatchResult>/gi;
  let m;
  while ((m = re.exec(matchXml)) !== null) {
    const b = m[1];
    out.push({ id: xmlTag(b,'BvDID'), name: xmlTag(b,'Name'), address: xmlTag(b,'Address'), postCode: xmlTag(b,'PostCode'), city: xmlTag(b,'City'), country: xmlTag(b,'Country'), website: xmlTag(b,'EMailOrWebsite'), ticker: xmlTag(b,'Ticker'), isin: xmlTag(b,'ISIN'), lei: xmlTag(b,'LEI') });
  }
  return out;
}

async function runDnb(s, name) {
  const id = Date.now().toString(36);
  const body = JSON.stringify({ grant_type: 'client_credentials' });
  await Logger.add({ id, timestamp: new Date().toISOString(), action: 'D&B Token', url: DNB_TOKEN_URL, requestBody: body, status: null, responseBody: null, durationMs: null, error: null, pending: true });
  const start = performance.now();
  const tokenRes = await fetch(DNB_TOKEN_URL, { method:'POST', headers:{'Authorization':`Basic ${s.dnb_basic_token}`,'Content-Type':'application/json'}, body });
  const durationMs = Math.round(performance.now() - start);
  const tokenText = await tokenRes.text();
  await Logger._updateEntry(id, { status: tokenRes.status, responseBody: tokenText, durationMs, pending: false });
  if (!tokenRes.ok) throw new Error(`D&B token error: HTTP ${tokenRes.status}`);
  const { access_token } = JSON.parse(tokenText);
  const sbody = JSON.stringify({ searchTerm: name, isStandalone: false, pageSize: 50, pageNumber: 1 });
  const id2 = Date.now().toString(36) + 's';
  await Logger.add({ id: id2, timestamp: new Date().toISOString(), action: 'D&B Search', url: DNB_SEARCH_URL, requestBody: sbody, status: null, responseBody: null, durationMs: null, error: null, pending: true });
  const start2 = performance.now();
  const searchRes = await fetch(DNB_SEARCH_URL, { method:'POST', headers:{'Authorization':`Bearer ${access_token}`,'Content-Type':'application/json'}, body: sbody });
  const dur2 = Math.round(performance.now() - start2);
  const searchText = await searchRes.text();
  await Logger._updateEntry(id2, { status: searchRes.status, responseBody: searchText, durationMs: dur2, pending: false });
  if (!searchRes.ok) throw new Error(`D&B search error: HTTP ${searchRes.status}`);
  const data = JSON.parse(searchText);
  return (data.searchCandidates || []).map(c => {
    const org = c.organization || {};
    const addr = org.primaryAddress || {};
    const loc = [addr.streetAddress?.line1, addr.postalCode, addr.addressLocality?.name, addr.addressRegion?.abbreviatedName, addr.addressCountry?.isoAlpha2Code].filter(Boolean).join(', ');
    return { id: org.duns||'', name: org.primaryName||'', location: loc, website: org.domain||'', ticker: org.tickerSymbol||'', isin:'', lei:'' };
  });
}

const SP_PROXY_URL = 'https://delicate-union-802c.patrickritzke.workers.dev';
let _spTokenCache = null;

async function getSpToken(username, password) {
  const now = Date.now();
  if (_spTokenCache && _spTokenCache.expiresAt > now + 30000) return _spTokenCache.accessToken;
  const basicCred = btoa(unescape(encodeURIComponent(username + ':' + password)));
  const tokenLogId = Date.now().toString(36) + 'sp-t';
  await Logger.add({ id: tokenLogId, timestamp: new Date().toISOString(), action: 'S&P Token', url: SP_AUTH_URL, requestBody: `username=${username}&password=***`, status: null, responseBody: null, durationMs: null, error: null, pending: true });
  const t0 = performance.now();
  const res = await fetch(SP_PROXY_URL + '/token', { method: 'POST', headers: { 'Authorization': 'Basic ' + basicCred, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username, password }).toString() });
  const text = await res.text();
  await Logger._updateEntry(tokenLogId, { status: res.status, responseBody: text, durationMs: Math.round(performance.now() - t0), pending: false });
  if (!res.ok) throw new Error('S&P auth failed (HTTP ' + res.status + '): ' + text.slice(0, 200));
  const data = JSON.parse(text);
  if (!data.access_token) throw new Error('S&P auth: no access_token');
  const expiresIn = parseInt(data.expires_in_seconds || '3500', 10);
  _spTokenCache = { accessToken: data.access_token, expiresAt: now + (expiresIn - 60) * 1000 };
  return _spTokenCache.accessToken;
}

async function runSp(s, name) {
  if (!s.sp_username || !s.sp_password) throw new Error('S&P credentials not set — open Settings and save your username and password.');
  const accessToken = await getSpToken(s.sp_username, s.sp_password);
  const searchBody = JSON.stringify({ inputRequests: [
    { function: 'GDSHE', identifier: name, mnemonic: 'IQ_COMPANY_NAME_QUICK_MATCH', properties: { startDate: '2024-01-01', endRank: '50' } },
    { function: 'GDSHE', identifier: name, mnemonic: 'IQ_COMPANY_ID_QUICK_MATCH',   properties: { startDate: '2024-01-01', endRank: '50' } },
  ]});
  const searchLogId = Date.now().toString(36) + 'sp-s';
  await Logger.add({ id: searchLogId, timestamp: new Date().toISOString(), action: 'S&P Search', url: SP_SEARCH_URL, requestBody: name, status: null, responseBody: null, durationMs: null, error: null, pending: true });
  const t1 = performance.now();
  const searchRes = await fetch(SP_PROXY_URL + '/search', { method: 'POST', headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: searchBody });
  const searchText = await searchRes.text();
  await Logger._updateEntry(searchLogId, { status: searchRes.status, responseBody: searchText, durationMs: Math.round(performance.now() - t1), pending: false });
  if (!searchRes.ok) { if (searchRes.status === 401) _spTokenCache = null; throw new Error('S&P search failed (HTTP ' + searchRes.status + '): ' + searchText.slice(0, 200)); }
  const data = JSON.parse(searchText);
  const responses = data.GDSSDKResponse || [];
  const nameRows = (responses[0] && responses[0].Rows) || [];
  const idRows   = (responses[1] && responses[1].Rows) || [];
  const out = [], ids = [];
  for (let i = 0; i < nameRows.length; i++) {
    const companyName = nameRows[i]?.Row?.[0], companyId = idRows[i]?.Row?.[0];
    if (!companyId || !companyName) continue;
    out.push({ id: companyId, name: companyName, location: '', website: '', ticker: '', isin: '', lei: '' }); ids.push(companyId);
  }
  if (!ids.length) return out;
  try {
    const enrichBody = JSON.stringify({ inputRequests: [
      ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COMPANY_TICKER',  properties: {} })),
      ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COMPANY_WEBSITE', properties: {} })),
      ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COMPANY_ADDRESS', properties: {} })),
      ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COUNTRY_NAME',    properties: {} })),
    ]});
    const enrichRes = await fetch(SP_PROXY_URL + '/search', { method: 'POST', headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, body: enrichBody });
    if (enrichRes.ok) {
      const er = (JSON.parse(await enrichRes.text()).GDSSDKResponse) || [];
      const n = ids.length;
      const getVal = b => b?.Rows?.[0]?.Row?.[0] || '';
      for (let i = 0; i < out.length; i++) { out[i].ticker = getVal(er[i]); out[i].website = getVal(er[n+i]); out[i].location = [getVal(er[2*n+i]), getVal(er[3*n+i])].filter(Boolean).join(', '); }
    }
  } catch (e) { console.warn('S&P enrichment failed:', e.message); }
  return out;
}

function renderProviderPage(p) {
  const results = p === 'moodys' ? moodysCandidates : p === 'dnb' ? dnbCandidates : spCandidates;
  let page      = p === 'moodys' ? moodysPage        : p === 'dnb' ? dnbPage        : spPage;
  const body    = document.getElementById(p + 'Body');
  const pagEl   = document.getElementById(p + '-pagination');
  const cardCls = p === 'moodys' ? 'result-card' : p === 'dnb' ? 'dnb-card' : 'sp-card';
  const idCls   = p === 'moodys' ? 'moodys-id'   : p === 'dnb' ? 'dnb-id'   : 'sp-id';
  if (!results.length) { body.innerHTML = `<div class="no-results">No results found.</div>`; pagEl.innerHTML = ''; return; }
  const total = Math.ceil(results.length / PAGE_SIZE);
  if (page > total) page = 1;
  const slice = results.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
  body.innerHTML = '';
  slice.forEach(c => {
    const loc = c.location || [c.address, [c.postCode, c.city].filter(Boolean).join(' '), c.country].filter(Boolean).join(', ');
    let tickerVal = c.ticker || '', marketVal = '';
    if (tickerVal.includes(':')) { const parts = tickerVal.split(':'); marketVal = parts[0].trim(); tickerVal = parts[1].trim(); }
    const metaItems = [{ key: 'market', val: marketVal }, { key: 'ticker', val: tickerVal }, { key: 'website', val: c.website }, { key: 'isin', val: c.isin }, { key: 'lei', val: c.lei }].filter(f => f.val);
    const metaHtml = metaItems.length ? `<div class="card-meta">${metaItems.map(f => `<span class="card-meta-item"><span class="card-meta-key">${f.key}</span><span class="card-meta-val">${escHtml(f.val)}</span></span>`).join('')}</div>` : '';
    const wrap = document.createElement('div'); wrap.className = 'card-wrap';
    const card = document.createElement('div'); card.className = cardCls;
    card.innerHTML = `<div class="card-id-row"><span class="card-id ${idCls}">${escHtml(c.id||'—')}</span><span class="copy-hint">copy ⧉</span></div><div class="card-name">${escHtml(c.name||'—')}</div>${loc ? `<div class="card-location">${escHtml(loc)}</div>` : ''}${metaHtml}`;
    card.addEventListener('click', () => navigator.clipboard.writeText(c.id).then(() => showToast('Copied: ' + c.id)));
    wrap.appendChild(card); body.appendChild(wrap);
  });
  renderPagination(pagEl, page, total, np => { if (p === 'moodys') moodysPage = np; else if (p === 'dnb') dnbPage = np; else spPage = np; renderProviderPage(p); body.parentElement.scrollTop = 0; }, p);
}

function renderPagination(el, current, total, onChange, p) {
  if (total <= 1) { el.innerHTML = ''; return; }
  const delta = 2;
  let pages = new Set([1, total]);
  for (let i = Math.max(1,current-delta); i <= Math.min(total,current+delta); i++) pages.add(i);
  pages = [...pages].sort((a,b)=>a-b);
  let html = `<div class="page-info">Page ${current} of ${total}</div><div class="page-btns">`;
  html += `<button class="page-btn" data-p="prev" ${current===1?'disabled':''}}>← Prev</button>`;
  let prev = null;
  for (const pg of pages) {
    if (prev !== null && pg - prev > 1) html += `<span class="page-ellipsis">…</span>`;
    html += `<button class="page-btn page-num ${pg===current?'active':''}" data-p="${pg}">${pg}</button>`;
    prev = pg;
  }
  html += `<button class="page-btn" data-p="next" ${current===total?'disabled':''}>Next →</button></div>`;
  el.innerHTML = html;
  el.querySelector('[data-p="prev"]')?.addEventListener('click', () => onChange(current-1));
  el.querySelector('[data-p="next"]')?.addEventListener('click', () => onChange(current+1));
  el.querySelectorAll('.page-num').forEach(b => b.addEventListener('click', () => onChange(parseInt(b.dataset.p))));
}

function normaliseWebsite(w) { return (w||'').replace(/^https?:\/\//i,'').replace(/^www\./i,'').replace(/\/.*$/,'').toLowerCase().trim(); }
function normaliseAddress(a) { return (a||'').toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim(); }

function buildMatches(moodys, dnb, sp, squishy) {
  const matches = [], usedM = new Set(), usedD = new Set(), usedS = new Set();
  const allProviders = [{ key: 'moodys', arr: moodys, used: usedM }, { key: 'dnb', arr: dnb, used: usedD }, { key: 'sp', arr: sp, used: usedS }].filter(p => p.arr.length);
  if (allProviders.length < 2) return { matches: [], unmoodys: moodys.length, undnb: dnb.length, unsp: sp.length };
  for (const idKey of ['ticker','isin','lei']) {
    const indexes = {};
    allProviders.forEach(({ key, arr }) => { indexes[key] = {}; arr.forEach((r,i) => { let v = (r[idKey]||'').toUpperCase(); if (idKey === 'ticker' && v.includes(':')) v = v.split(':')[1].trim(); if(v) indexes[key][v]=i; }); });
    const allVals = new Set(allProviders.flatMap(({ key }) => Object.keys(indexes[key])));
    for (const val of allVals) {
      const hits = allProviders.filter(({ key }) => indexes[key][val] !== undefined);
      if (hits.length < 2) continue;
      const sig = allProviders.map(({ key }) => indexes[key][val] ?? '-').join(':');
      if (matches.some(m => m.sig === sig)) continue;
      const entry = { key: idKey.toUpperCase(), val, sig, type: 'exact', moodys: null, dnb: null, sp: null };
      hits.forEach(({ key, arr }) => { entry[key] = arr[indexes[key][val]]; hits.forEach(h => h.used.add(indexes[h.key][val])); });
      matches.push(entry);
    }
  }
  if (squishy) {
    for (const [label, extractor] of [['Website', r => normaliseWebsite(r.website)], ['Address', r => normaliseAddress([r.address||'', r.city||''].join(' ') || (r.location||'').split(',').slice(0,2).join(' '))]]) {
      const indexes = {};
      allProviders.forEach(({ key, arr }) => { indexes[key] = {}; arr.forEach((r,i) => { const v = extractor(r); if (v && v.length > 5) indexes[key][v] = i; }); });
      const allVals = new Set(allProviders.flatMap(({ key }) => Object.keys(indexes[key])));
      for (const val of allVals) {
        const hits = allProviders.filter(({ key }) => indexes[key][val] !== undefined);
        if (hits.length < 2) continue;
        const sig = allProviders.map(({ key }) => indexes[key][val] ?? '-').join(':');
        if (matches.some(m => m.sig === sig)) continue;
        const entry = { key: label, val, sig, type: 'squishy', moodys: null, dnb: null, sp: null };
        hits.forEach(({ key, arr }) => { entry[key] = arr[indexes[key][val]]; hits.forEach(h => h.used.add(indexes[h.key][val])); });
        matches.push(entry);
      }
    }
  }
  return { matches, unmoodys: moodys.length - usedM.size, undnb: dnb.length - usedD.size, unsp: sp.length - usedS.size };
}

function renderMatched() {
  const active = [moodysCandidates.length ? 'moodys' : null, dnbCandidates.length ? 'dnb' : null, spCandidates.length ? 'sp' : null].filter(Boolean);
  const { matches, unmoodys, undnb, unsp } = buildMatches(moodysCandidates, dnbCandidates, spCandidates, squishyEnabled);
  const el = document.getElementById('matchedCount'); if (el) el.textContent = matches.length;
  const body = document.getElementById('matchedBody');
  if (!matches.length) { body.innerHTML = '<div class="no-results">No cross-provider matches found.<br>Try Squishy Match, or browse individual tabs.</div>'; return; }
  const colHtml = (p, result) => {
    const label = p === 'moodys' ? "Moody's" : p === 'dnb' ? 'D&B' : 'S&P';
    if (!result) return `<div class="match-col"><div class="col-provider"><div class="col-dot dot-${p}"></div><span class="col-provider-name">${label}</span></div><div class="col-empty">No match</div></div>`;
    const id = result.id || '—';
    const loc = result.location || [result.address, [result.postCode, result.city].filter(Boolean).join(' '), result.country].filter(Boolean).join(', ');
    return `<div class="match-col"><div class="col-provider"><div class="col-dot dot-${p}"></div><span class="col-provider-name">${label}</span></div><div class="col-id-val col-id-${p}" data-copy="${escHtml(id)}" style="cursor:pointer">${escHtml(id)} <span style="font-size:9px;opacity:.4">⧉</span></div><div class="col-name">${escHtml(result.name||'—')}</div>${loc ? `<div class="col-sub">${escHtml(loc)}</div>` : ''}</div>`;
  };
  body.innerHTML = '';
  matches.forEach(m => {
    const row = document.createElement('div'); row.className = 'match-row';
    row.innerHTML = `<div class="match-key-bar"><span class="match-key-label">${escHtml(m.key)}</span><span class="match-key-val">${escHtml(m.val)}</span><span class="match-key-badge ${m.type === 'exact' ? 'badge-exact' : 'badge-squishy'}">${m.type === 'exact' ? 'Exact' : 'Squishy'}</span></div><div class="match-cols" style="--match-cols:${active.length}">${active.map(p => colHtml(p, m[p])).join('')}</div>`;
    row.querySelectorAll('[data-copy]').forEach(el => { el.addEventListener('click', () => navigator.clipboard.writeText(el.dataset.copy).then(() => showToast('Copied: ' + el.dataset.copy))); });
    body.appendChild(row);
  });
  const parts = [];
  if (unmoodys) parts.push(`${unmoodys} Moody's`);
  if (undnb)    parts.push(`${undnb} D&B`);
  if (unsp)     parts.push(`${unsp} S&P`);
  if (parts.length) {
    const note = document.createElement('div'); note.className = 'unmatched-note';
    note.textContent = `${parts.join(' · ')} results without a high-confidence match — browse individual tabs for full results.`;
    body.appendChild(note);
  }
}

function showToast(msg) { toast.textContent = msg; toast.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => toast.classList.remove('show'), 1800); }
function escHtml(str) { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
document.addEventListener('keydown', e => { if (e.key === 'Enter' && document.activeElement.id === 'name') doSearch(); });

refreshProviders();
