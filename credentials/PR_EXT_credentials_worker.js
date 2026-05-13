// ─── PR_EXT_credentials_worker.js ────────────────────────────────────────────
// Cloudflare Worker — proxy for S&P Capital IQ + S&P Xpressapi
//
// ROUTES:
//   POST /token        → CapIQ auth    (Basic auth + form body)
//   POST /search       → CapIQ search  (Bearer + JSON body)
//   POST /xpx/token    → Xpressapi auth (username/password as query params only)
//   POST /xpx/search   → Xpressapi search (Bearer + JSON body, X-SPX-Path header)
//   OPTIONS *          → CORS preflight
// ─────────────────────────────────────────────────────────────────────────────

const SP_AUTH_URL   = 'https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/authenticate/api/v1/token';
const SP_SEARCH_URL = 'https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/v3/clientservice.json';
const SPX_AUTH_URL  = 'https://xpressapi.marketplace.spglobal.com/authenticate/api/v1/token';
const SPX_BASE_URL  = 'https://xpressapi.marketplace.spglobal.com';

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return corsResponse('', 204);
    if (request.method !== 'POST') return corsResponse(JSON.stringify({ error: 'Method not allowed' }), 405);

    const url = new URL(request.url);

    // ── CapIQ: POST /token ────────────────────────────────────────────────────
    if (url.pathname === '/token') {
      const body = await request.text();
      const authHeader = request.headers.get('Authorization') || '';
      const spRes = await fetch(SP_AUTH_URL, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': '*/*', 'Cache-Control': 'no-cache' },
        body,
      });
      return corsResponse(await spRes.text(), spRes.status);
    }

    // ── CapIQ: POST /search ───────────────────────────────────────────────────
    if (url.pathname === '/search') {
      const body = await request.text();
      const authHeader = request.headers.get('Authorization') || '';
      const spRes = await fetch(SP_SEARCH_URL, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': '*/*' },
        body,
      });
      return corsResponse(await spRes.text(), spRes.status);
    }

    // ── Xpressapi: POST /xpx/token ────────────────────────────────────────────
    // Credentials must be query params only — no body, no Content-Type
    if (url.pathname === '/xpx/token') {
      let body;
      try { body = await request.json(); } catch { return corsResponse(JSON.stringify({ error: 'Invalid JSON body' }), 400); }
      const { username, password } = body;
      if (!username || !password) return corsResponse(JSON.stringify({ error: 'username and password required' }), 400);
      const authUrl = `${SPX_AUTH_URL}?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
      const spRes = await fetch(authUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': '*/*',
        },
        body: '{ "grant_type" : "client_credentials" }',
      });
      return corsResponse(await spRes.text(), spRes.status);
    }

    // ── Xpressapi: POST /xpx/search ───────────────────────────────────────────
    // Header: X-SPX-Path: /the/api/path
    if (url.pathname === '/xpx/search') {
      const body = await request.text();
      const authHeader = request.headers.get('Authorization') || '';
      const spxPath = request.headers.get('X-SPX-Path') || '';
      if (!spxPath) return corsResponse(JSON.stringify({ error: 'X-SPX-Path header required' }), 400);
      const spRes = await fetch(SPX_BASE_URL + spxPath, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'Accept': '*/*' },
        body,
      });
      return corsResponse(await spRes.text(), spRes.status);
    }

    return corsResponse(JSON.stringify({ error: 'Not found' }), 404);
  }
};

function corsResponse(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-SPX-Path, Cache-Control, Accept',
      'Content-Type': 'application/json',
    },
  });
}
