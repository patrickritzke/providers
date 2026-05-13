# credentials — Reference

**Extension name:** PR_EXT_credentials  
**Version:** 1.1.4  
**Purpose:** Drop-in credential manager component for Intapp Chrome extensions. Manages credentials and token caching for 6 third-party APIs from a single self-contained popup UI.

> **Note:** This is functionally identical to `tree-compare/` (PR_EXT_tree_compare v1.1.4). The only difference is the file naming (`PR_EXT_credentials.*` vs `PR_EXT_tree_compare.*`) and the inner footer label. All logic, storage keys, worker routes, and patterns are the same.

---

## Architecture

```
PR_EXT_credentials.html          ← popup shell (320px)
  └─ <div id="credentials-root"> ← mount point
PR_EXT_credentials.js            ← IIFE: renders UI + exposes CredentialsManager global
PR_EXT_credentials_worker.js     ← Cloudflare Worker (ES module) — CORS proxy for S&P
```

**Manifest V3** — no background service worker. The popup is the entire extension. All state lives in `chrome.storage.local`.

---

## CredentialsManager API

Exposed as a global from the IIFE. Auto-mounts on `DOMContentLoaded` if `#credentials-root` exists.

```js
CredentialsManager.mount('#credentials-root')  // custom selector (optional)

// Storage wrappers (promisified chrome.storage.local)
const data = await CredentialsManager.get(['dnb_basic_token', 'sp_username']);
await CredentialsManager.set({ dnb_basic_token: 'abc' });
await CredentialsManager.remove(['spx_token']);

// Returns valid Xpressapi bearer, throws if missing or expiring
const token = await CredentialsManager.getSpxToken();
// throws: 'NO_SPX_TOKEN' | 'SPX_TOKEN_EXPIRED'
```

### `getSpxToken()` expiry logic

```js
if (Date.now() >= spx_token.expiresAt - 30000) throw new Error('SPX_TOKEN_EXPIRED');
// 30-second buffer before actual expiry
```

---

## Storage Keys

All in `chrome.storage.local`. Can be read directly with `chrome.storage.local.get` — no need to go through `CredentialsManager.get`.

| Key | Type | Description |
|-----|------|-------------|
| `intapp_credentials` | `{ appHost, tenantId, clientId, clientSecret, redirectUri }` | Intapp OAuth2 config |
| `intapp_token` | `{ token, expiresAt }` | Cached Intapp bearer (managed by background, not UI) |
| `dnb_basic_token` | `string` | Pre-encoded `btoa('key:secret')` |
| `geoapify_api_key` | `string` | Raw API key |
| `moodys_username` | `string` | BvD/Orbis login |
| `moodys_password` | `string` | BvD/Orbis password |
| `moodys_base_url` | `string` | Optional BvD endpoint override (falls back to hardcoded URL) |
| `sp_username` | `string` | S&P Capital IQ username |
| `sp_password` | `string` | S&P Capital IQ password |
| `spx_username` | `string` | S&P Xpressapi username |
| `spx_password` | `string` | S&P Xpressapi password |
| `spx_token` | `{ access_token, refresh_token, expiresAt }` | Cached Xpressapi bearer |

---

## Provider Auth Details

### 1. Intapp — OAuth2 `client_credentials`

```
POST https://{appHost}/auth/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id={clientId}&client_secret={clientSecret}&redirect_uri={redirectUri}
```

- `appHost` stored without protocol — stripped on save with `.replace(/^https?:\/\//, '')`
- Test delegates to background via `chrome.runtime.sendMessage({ type: 'TEST_INTAPP', creds: {...} })`
- Response shape: `{ ok: bool, error?: string, detail?: string }`

### 2. D&B Direct+ — pre-encoded Basic → bearer

```
POST https://plus.dnb.com/v2/token
Authorization: Basic {dnb_basic_token}
Content-Type: application/json

{ "grant_type": "client_credentials" }
```

- User pre-computes `btoa('key:secret')` — the extension stores and uses it as-is
- No proxy needed; D&B allows direct browser requests
- Test delegates via `chrome.runtime.sendMessage({ type: 'TEST_DNB', token })`

### 3. Geoapify — API key query param

```
GET https://api.geoapify.com/v1/geocode/search?text={query}&apiKey={geoapify_api_key}
```

- Direct fetch, no proxy
- Test probes `'1600 Pennsylvania Ave, Washington DC'`
- Response: `{ features: [{ properties: { formatted: string } }] }`
- Free tier: 3,000 req/day

### 4. Moody's / BvD (Orbis) — SOAP session

**Endpoint:** `https://webservices.bvdinfo.com/v1.3/orbis4/remoteaccess.asmx`  
(hardcoded since v1.1.4; `moodys_base_url` in storage overrides this in Test All only)

```xml
POST {endpoint}
Content-Type: text/xml; charset=utf-8
SOAPAction: http://bvdep.com/webservices/Open

<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:web="http://bvdep.com/webservices/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:Open>
      <web:username>{username}</web:username>
      <web:password>{password}</web:password>
    </web:Open>
  </soapenv:Body>
</soapenv:Envelope>
```

- Success: response contains `<OpenResult>R1|{sessionId}</OpenResult>`
- Extracted with: `text.match(/<OpenResult>(.*?)<\/OpenResult>/)`
- Sessions are NOT cached — callers must call Open before each use
- 403 = bad credentials (not a CORS or code issue)
- No proxy needed

### 5. S&P Capital IQ — Basic → Bearer via proxy

```
POST https://delicate-union-802c.patrickritzke.workers.dev/token
Authorization: Basic {btoa(username:password)}
Content-Type: application/x-www-form-urlencoded
Accept: */*

username={username}&password={password}
```

- Proxy forwards to: `https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/authenticate/api/v1/token`
- Response: `{ access_token, ... }`
- Token is NOT cached to storage — fetched fresh on each test
- MUST use proxy (S&P rejects requests with browser `Origin` header)

### 6. S&P Xpressapi — unusual auth pattern

**Via proxy** (`POST /xpx/token`): extension sends `{ username, password }` as JSON.

**Worker reconstructs the actual request:**
```
POST https://xpressapi.marketplace.spglobal.com/authenticate/api/v1/token
     ?username={username}&password={password}   ← credentials as URL query params
Authorization: Basic                             ← trailing space, NO value after it
Content-Type: application/x-www-form-urlencoded

{ "grant_type" : "client_credentials" }         ← JSON string sent with form-encoded CT
```

> **Critical gotcha:** `Authorization: Basic ` with a trailing space and nothing after it. Standard `Basic btoa(...)` will be rejected. Body is a literal JSON-looking string despite `Content-Type: application/x-www-form-urlencoded`. This is how Xpressapi expects it (verified via Postman).

**Token storage after successful auth:**
```js
{
  access_token: '...',
  refresh_token: '...' | null,
  expiresAt: Date.now() + (expires_in_seconds || 3600) * 1000
}
```

**Search** (via proxy `/xpx/search`):
```
POST {proxy}/xpx/search
Authorization: Bearer {access_token}
X-SPX-Path: /the/api/path
Content-Type: application/json
```

---

## Cloudflare Worker

**URL:** `https://delicate-union-802c.patrickritzke.workers.dev`  
**File:** `PR_EXT_credentials_worker.js`  
**Format:** ES module — `export default { async fetch(request) {} }` (NOT legacy `addEventListener`)

| Route | Proxies to |
|-------|------------|
| `POST /token` | S&P CapIQ auth |
| `POST /search` | S&P CapIQ search |
| `POST /xpx/token` | Xpressapi token (injects query params + `Authorization: Basic `) |
| `POST /xpx/search` | Xpressapi search (reads `X-SPX-Path` header) |
| `OPTIONS *` | CORS preflight → 204 |

CORS headers on all responses:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-SPX-Path, Cache-Control, Accept
```

---

## UI Patterns

### Embedding in another extension

```html
<div id="credentials-root"></div>
<script src="PR_EXT_credentials.js"></script>
<!-- auto-mounts on DOMContentLoaded -->
```

Manifest requirements:
```json
"permissions": ["storage", "clipboardRead", "clipboardWrite"],
"host_permissions": ["https://*/*"]
```

### As standalone options page

```json
"options_page": "PR_EXT_credentials.html"
```

### Template injection

The entire UI (CSS + HTML) is a single `TEMPLATE` string inside the IIFE, injected via `root.innerHTML = TEMPLATE`. Fully self-contained, no external stylesheets.

### `saveAndTest` pattern

```js
async function saveAndTest(id, saveFn, testFn) {
  // Save always runs first and independently
  await saveFn();           // on failure → shows error, returns early
  const result = await testFn();
  // test failure → shows "✓ Saved — test failed: ..."
  // test success → shows "✓ Saved & connected — {result}"
}
```

### Toast system

```js
toast(id, message, type, durationMs)
// type: 'ok' | 'err' | 'info'
// Each section has <div class="creds-toast" id="toast-{id}">
```

### Copy All / Paste All clipboard format

```
key:value|key:value|key:value
```

- Serialized keys use hyphens matching HTML `id` attributes (e.g. `intapp-host`) — not storage key names (which use underscores)
- Parsed with `chunk.indexOf(':')` → splits on first colon only, so URLs and base64 tokens survive
- On paste: updates visible fields AND persists to storage; Intapp fields merged with existing stored object (partial paste safe)

### Test All output format

```
✅ Intapp: token received
✅ D&B: token received
✅ Geoapify: 1600 Pennsylvania Ave NW, Washington, DC...
⬜ Moody's / BvD: not configured
❌ S&P Capital IQ: HTTP 401
✅ S&P Xpressapi: token received
```

---

## Background Message Contract

The popup sends these messages to the host extension's `background.js`:

| Type | Payload | Expected response |
|------|---------|-------------------|
| `TEST_INTAPP` | `{ creds: { appHost, clientId, clientSecret, redirectUri } }` | `{ ok: bool, error?: string, detail?: string }` |
| `TEST_DNB` | `{ token: string }` | `{ ok: bool, error?: string, detail?: string }` |

---

## Debugging Console Scripts

Run from popup DevTools (right-click popup → Inspect → Console):

```js
// Test Xpressapi via proxy
(async () => {
  const s = await chrome.storage.local.get(['spx_username', 'spx_password']);
  const res = await fetch('https://delicate-union-802c.patrickritzke.workers.dev/xpx/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: s.spx_username, password: s.spx_password })
  });
  console.log(res.status, await res.text());
})();

// Test BvD SOAP
(async () => {
  const s = await chrome.storage.local.get(['moodys_username', 'moodys_password']);
  const soap = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://bvdep.com/webservices/"><soapenv:Header/><soapenv:Body><web:Open><web:username>${s.moodys_username}</web:username><web:password>${s.moodys_password}</web:password></web:Open></soapenv:Body></soapenv:Envelope>`;
  const res = await fetch('https://webservices.bvdinfo.com/v1.3/orbis4/remoteaccess.asmx', {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'http://bvdep.com/webservices/Open' },
    body: soap
  });
  console.log(res.status, await res.text());
})();

// Dump all storage keys (no secret values)
(async () => {
  const s = await chrome.storage.local.get(null);
  Object.keys(s).forEach(k => {
    const v = s[k];
    console.log(k, typeof v === 'string' ? `string[${v.length}]` : JSON.stringify(v).slice(0, 80));
  });
})();
```

---

## Known Gotchas

1. **Cloudflare Worker syntax** — must use `export default { async fetch() }`, NOT `addEventListener('fetch')`
2. **BvD is SOAP, not REST** — `api.bvdinfo.com` is a different product. A 403 from SOAP = bad credentials, not a code issue
3. **Xpressapi Content-Type** — 415 error means wrong CT reaching Xpressapi. Body must be the literal string `'{ "grant_type" : "client_credentials" }'` with `Content-Type: application/x-www-form-urlencoded`
4. **Copy All key names use hyphens** — `CP_KEYS` items like `'intapp-host'` match HTML element IDs, not storage keys (`intapp_credentials`). Two separate namespaces.
5. **D&B token is pre-encoded** — user computes `btoa('key:secret')` themselves; no separate key/secret fields
6. **Intapp appHost — no protocol** — store subdomain only; extension prepends `https://` when building the token URL
