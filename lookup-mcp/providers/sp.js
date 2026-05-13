const AUTH_URL   = 'https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/authenticate/api/v1/token';
const SEARCH_URL = 'https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/v3/clientservice.json';

let _tokenCache = null;

async function getToken() {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 30000) return _tokenCache.accessToken;

  const username = process.env.SP_USERNAME;
  const password = process.env.SP_PASSWORD;
  if (!username || !password) throw new Error('SP_USERNAME and SP_PASSWORD required');

  const basicCred = Buffer.from(`${username}:${password}`).toString('base64');
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basicCred}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }).toString(),
  });
  if (!res.ok) throw new Error(`S&P auth HTTP ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('S&P auth: no access_token in response');

  const expiresIn = parseInt(data.expires_in_seconds || '3500', 10);
  _tokenCache = { accessToken: data.access_token, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
  return _tokenCache.accessToken;
}

async function gdsRequest(token, body) {
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401) _tokenCache = null;
    throw new Error(`S&P GDS HTTP ${res.status}`);
  }
  return res.json();
}

export async function search(name) {
  const token = await getToken();

  const quickData = await gdsRequest(token, {
    inputRequests: [
      { function: 'GDSHE', identifier: name, mnemonic: 'IQ_COMPANY_NAME_QUICK_MATCH', properties: { startDate: '2024-01-01', endRank: '50' } },
      { function: 'GDSHE', identifier: name, mnemonic: 'IQ_COMPANY_ID_QUICK_MATCH',   properties: { startDate: '2024-01-01', endRank: '50' } },
    ],
  });

  const responses  = quickData.GDSSDKResponse || [];
  const nameRows   = responses[0]?.Rows || [];
  const idRows     = responses[1]?.Rows || [];

  const results = [];
  const ids     = [];
  for (let i = 0; i < nameRows.length; i++) {
    const companyName = nameRows[i]?.Row?.[0];
    const companyId   = idRows[i]?.Row?.[0];
    if (!companyId || !companyName) continue;
    results.push({ id: companyId, name: companyName, location: '', website: '', ticker: '', isin: '', lei: '' });
    ids.push(companyId);
  }

  if (!ids.length) return results;

  try {
    const n = ids.length;
    const enrichData = await gdsRequest(token, {
      inputRequests: [
        ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COMPANY_TICKER',  properties: {} })),
        ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COMPANY_WEBSITE', properties: {} })),
        ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COMPANY_ADDRESS', properties: {} })),
        ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COUNTRY_NAME',    properties: {} })),
      ],
    });
    const er     = enrichData.GDSSDKResponse || [];
    const getVal = b => b?.Rows?.[0]?.Row?.[0] || '';
    for (let i = 0; i < results.length; i++) {
      results[i].ticker   = getVal(er[i]);
      results[i].website  = getVal(er[n + i]);
      results[i].location = [getVal(er[2*n + i]), getVal(er[3*n + i])].filter(Boolean).join(', ');
    }
  } catch {
    // enrich failure is non-fatal — search results still returned
  }

  return results;
}
