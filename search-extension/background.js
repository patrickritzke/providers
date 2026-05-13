const SP_AUTH_URL   = 'https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/authenticate/api/v1/token';
const SP_SEARCH_URL = 'https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/v3/clientservice.json';

// Keep service worker alive with a periodic alarm
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => { /* no-op, just keeps worker alive */ });

// ── Cloudflare Worker proxy ───────────────────────────────────────────────────
// Replace with your deployed worker URL once set up.
// e.g. 'https://sp-proxy.YOUR-SUBDOMAIN.workers.dev'
const SP_PROXY_URL = 'https://delicate-union-802c.patrickritzke.workers.dev';

let _spTokenCache = null;

// Poll storage every second for pending jobs
let _processingJob = false;

function pollForJobs() {
  chrome.storage.local.get(['SP_JOB', 'SP_RESULT'], res => {
    const job = res.SP_JOB;
    const result = res.SP_RESULT;
    if (job && job.status === 'pending' && (!result || result.jobId !== job.jobId) && !_processingJob) {
      console.log('[BG] SP_JOB found:', job.name);
      _processingJob = true;
      handleSpSearch(job).then(r => {
        chrome.storage.local.set({ SP_RESULT: { ...r, jobId: job.jobId } });
        _processingJob = false;
      }).catch(e => {
        chrome.storage.local.set({ SP_RESULT: { error: e.message, jobId: job.jobId } });
        _processingJob = false;
      });
    }
  });
}

// Poll every second
setInterval(pollForJobs, 1000);

// Also keep alive with alarms
chrome.alarms.onAlarm.addListener(pollForJobs);

async function handleSpSearch({ username, password, name }) {
  const now = Date.now();
  let tokenLog = null;

  if (!_spTokenCache || _spTokenCache.expiresAt <= now + 30000) {
    const spUser = safeDecodeURI(username);
    const spPass = safeDecodeURI(password);
    const basicCred = btoa(unescape(encodeURIComponent(spUser + ':' + spPass)));
    const body = new URLSearchParams({ username: spUser, password: spPass });
    const t0 = Date.now();

    let authRes, authText;
    try {
      const tokenUrl = SP_PROXY_URL ? SP_PROXY_URL + '/token' : SP_AUTH_URL;
      authRes  = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + basicCred,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': '*/*',
        },
        body: body.toString(),
      });
      authText = await authRes.text();
    } catch (e) {
      return { error: 'S&P network error: ' + e.message, tokenLog: { action: 'S&P Token', url: SP_AUTH_URL, status: 0, responseBody: e.message, durationMs: Date.now() - t0 }, searchLog: null };
    }

    tokenLog = { action: 'S&P Token', url: SP_AUTH_URL, status: authRes.status, responseBody: authText, durationMs: Date.now() - t0 };

    if (!authRes.ok) {
      return { error: 'S&P auth failed (HTTP ' + authRes.status + '): ' + authText.slice(0, 300), tokenLog, searchLog: null };
    }

    let authData;
    try { authData = JSON.parse(authText); }
    catch (e) { return { error: 'S&P auth: bad JSON', tokenLog, searchLog: null }; }

    if (!authData.access_token) {
      return { error: 'S&P auth: no access_token. Keys: ' + Object.keys(authData).join(', '), tokenLog, searchLog: null };
    }

    const expiresIn = parseInt(authData.expires_in_seconds || '3500', 10);
    _spTokenCache = { accessToken: authData.access_token, expiresAt: now + (expiresIn - 60) * 1000 };
  }

  const searchBody = JSON.stringify({
    inputRequests: [
      { function: 'GDSHE', identifier: name, mnemonic: 'IQ_COMPANY_NAME_QUICK_MATCH', properties: { startDate: '2024-01-01', endRank: '50' } },
      { function: 'GDSHE', identifier: name, mnemonic: 'IQ_COMPANY_ID_QUICK_MATCH',   properties: { startDate: '2024-01-01', endRank: '50' } },
    ],
  });
  const t1 = Date.now();

  let searchRes, searchText;
  try {
    const searchUrl = SP_PROXY_URL ? SP_PROXY_URL + '/search' : SP_SEARCH_URL;
    searchRes  = await fetch(searchUrl, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + _spTokenCache.accessToken, 'Content-Type': 'application/json' },
      body: searchBody,
    });
    searchText = await searchRes.text();
  } catch (e) {
    return { error: 'S&P search network error: ' + e.message, tokenLog, searchLog: { action: 'S&P Search', url: SP_SEARCH_URL, status: 0, responseBody: e.message, durationMs: Date.now() - t1 } };
  }

  const searchLog = { action: 'S&P Search', url: SP_SEARCH_URL, status: searchRes.status, responseBody: searchText, durationMs: Date.now() - t1 };

  if (!searchRes.ok) {
    if (searchRes.status === 401) _spTokenCache = null;
    return { error: 'S&P search failed (HTTP ' + searchRes.status + '): ' + searchText.slice(0, 200), tokenLog, searchLog };
  }

  let data;
  try { data = JSON.parse(searchText); }
  catch (e) { return { error: 'S&P search: bad JSON', tokenLog, searchLog }; }

  return { results: parseGmatch(data, name), tokenLog, searchLog };
}

function parseGmatch(data, name) {
  // Response has two GDSSDKResponse entries: [0] = names, [1] = IDs
  // Each Rows[i].Row[0] is the value for that result index
  const responses = (data && data.GDSSDKResponse) || [];
  const nameRows = (responses[0] && responses[0].Rows) || [];
  const idRows   = (responses[1] && responses[1].Rows) || [];

  const out = [];
  for (let i = 0; i < nameRows.length; i++) {
    const companyName = nameRows[i] && nameRows[i].Row && nameRows[i].Row[0];
    const companyId   = idRows[i]   && idRows[i].Row   && idRows[i].Row[0];
    if (!companyId || !companyName) continue;
    out.push({
      id:       companyId,
      name:     companyName,
      location: '',
      website:  '',
      ticker:   '',
      isin:     '',
      lei:      '',
    });
  }
  return out;
}

function safeDecodeURI(str) {
  try { return decodeURIComponent(str); } catch (e) { return str; }
}
