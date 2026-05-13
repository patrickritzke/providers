# tree-compare — Reference

**Extension name:** PR_EXT_tree_compare  
**Version:** 1.1.4  
**Purpose:** Drop-in credential manager component for Intapp Chrome extensions. Manages credentials and token caching for 6 third-party APIs from a single popup UI.

---

## Architecture Overview

```
PR_EXT_tree_compare.html          ← popup shell (320px)
  └─ <div id="credentials-root">  ← mount point
PR_EXT_tree_compare.js            ← self-contained IIFE that mounts UI + exposes CredentialsManager
PR_EXT_tree_compare_worker.js     ← Cloudflare Worker (ES module) — CORS proxy for S&P CapIQ + Xpressapi
```

**Manifest V3** — no background service worker in this extension; the popup IS the entire extension. All storage is `chrome.storage.local`.

---

## CredentialsManager API

The module is a self-executing IIFE that exposes a global `CredentialsManager` object.

```js
// Auto-mounts on DOMContentLoaded if #credentials-root exists
CredentialsManager.mount('#credentials-root')   // optional custom selector

// Read any storage keys
const { dnb_basic_token, sp_username } = await CredentialsManager.get(['dnb_basic_token', 'sp_username']);

// Write to storage
await CredentialsManager.set({ dnb_basic_token: 'abc123' });

// Remove keys
await CredentialsManager.remove(['spx_token']);

// Get a valid Xpressapi bearer token (throws if missing/expired)
const token = await CredentialsManager.getSpxToken(); // throws 'NO_SPX_TOKEN' or 'SPX_TOKEN_EXPIRED'
```

### `getSpxToken()` — token validation logic

```js
async function getSpxToken() {
  const { spx_token } = await get(['spx_token']);
  if (!spx_token?.access_token) throw new Error('NO_SPX_TOKEN');
  if (Date.now() >= spx_token.expiresAt - 30000) throw new Error('SPX_TOKEN_EXPIRED');  // 30s buffer
  return spx_token.access_token;
}
```

---

## Storage Keys

All keys live in `chrome.storage.local`.

| Key | Type | Description |
|-----|------|-------------|
| `intapp_credentials` | `{ appHost, tenantId, clientId, clientSecret, redirectUri }` | Intapp OAuth2 config |
| `intapp_token` | `{ token, expiresAt }` | Cached Intapp bearer (managed by background, not UI) |
| `dnb_basic_token` | `string` | Pre-encoded `btoa('key:secret')` |
| `geoapify_api_key` | `string` | Raw API key |
| `moodys_username` | `string` | BvD/Orbis login |
| `moodys_password` | `string` | BvD/Orbis password |
| `sp_username` | `string` | S&P Capital IQ / Market Intelligence username |
| `sp_password` | `string` | S&P Capital IQ password |
| `spx_username` | `string` | S&P Xpressapi username |
| `spx_password` | `string` | S&P Xpressapi password |
| `spx_token` | `{ access_token, refresh_token, expiresAt }` | Cached Xpressapi bearer |

Note: `intapp_token` shape differs between this extension (`{ token, expiresAt }`) and the search-extension which used `{ accessToken, expiresAt }` — watch for this discrepancy.

---

## Provider Integration Details

### 1. Intapp — OAuth2 `client_credentials`

```
POST https://{appHost}/auth/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id={clientId}&client_secret={clientSecret}&redirect_uri={redirectUri}
```

- `appHost` stored without `https://` prefix (stripped on save: `.replace(/^https?:\/\//, '')`)
- Token test sends message to background: `{ type: 'TEST_INTAPP', creds: { appHost, clientId, clientSecret, redirectUri } }`
- Background manages token cache in `intapp_token`

### 2. D&B Direct+ — `client_credentials` bearer exchange

```
POST https://plus.dnb.com/v2/token
Authorization: Basic {dnb_basic_token}   ← pre-encoded btoa('key:secret')
Content-Type: application/json

{ "grant_type": "client_credentials" }
```

- Response: `{ access_token, expiresIn, tokenType }`
- Token is NOT cached to storage — fetched fresh each time
- Test via background message: `{ type: 'TEST_DNB', token }`

### 3. Geoapify — API key query param

```
GET https://api.geoapify.com/v1/geocode/search?text={query}&apiKey={geoapify_api_key}
```

- Direct fetch, no proxy needed
- Test uses `'1600 Pennsylvania Ave, Washington DC'` as probe address
- Response: `{ features: [{ properties: { formatted: '...' } }] }`

### 4. Moody's / Bureau van Dijk (BvD Orbis) — SOAP

**Endpoint:** `https://webservices.bvdinfo.com/v1.3/orbis4/remoteaccess.asmx` (hardcoded since v1.1.4)

**Step 1 — Open (auth)**
```xml
POST {endpoint}
Content-Type: text/xml; charset=utf-8
SOAPAction: http://bvdep.com/webservices/Open

<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://bvdep.com/webservices/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:Open>
      <web:username>{username}</web:username>
      <web:password>{password}</web:password>
    </web:Open>
  </soapenv:Body>
</soapenv:Envelope>
```
- Response contains `<OpenResult>{sessionId}</OpenResult>`
- Session ID is extracted with: `text.match(/<OpenResult>(.*?)<\/OpenResult>/)`

**Step 2 — Match (search with session)**
```xml
SOAPAction: http://bvdep.com/webservices/Match
<!-- sessionId passed inside the SOAP body -->
```

### 5. S&P Capital IQ / Market Intelligence — Basic → Bearer

**Auth** (via Cloudflare proxy `/token`):
```
POST https://delicate-union-802c.patrickritzke.workers.dev/token
Authorization: Basic {btoa(username:password)}
Content-Type: application/x-www-form-urlencoded
Accept: */*

username={username}&password={password}
```
- Proxy forwards to: `https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/authenticate/api/v1/token`
- Response: `{ access_token, ... }`

**Search** (via proxy `/search`):
```
POST {proxy}/search
Authorization: Bearer {access_token}
Content-Type: application/json

{ /* GDSP/GDSHE search body */ }
```

### 6. S&P Xpressapi — Unusual auth pattern

**Auth** (via proxy `/xpx/token`):
```
POST https://delicate-union-802c.patrickritzke.workers.dev/xpx/token
Content-Type: application/json

{ "username": "...", "password": "..." }
```

The worker then reconstructs the actual Xpressapi request:
```
POST https://xpressapi.marketplace.spglobal.com/authenticate/api/v1/token
     ?username={username}&password={password}   ← credentials as URL query params
Authorization: Basic                              ← trailing space, NO value
Content-Type: application/x-www-form-urlencoded

{ "grant_type" : "client_credentials" }          ← literal string, despite x-www-form-urlencoded header
```

> **Critical gotcha:** `Authorization: Basic ` with a trailing space and no value. Standard `Basic btoa(...)` will be rejected. The body must be the JSON string `'{ "grant_type" : "client_credentials" }'` even though `Content-Type` says `x-www-form-urlencoded`. This matches Postman exactly.

**Token storage:**
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
X-SPX-Path: {api-path-header}
Content-Type: application/json

{ /* search body */ }
```

---

## Cloudflare Worker

**URL:** `https://delicate-union-802c.patrickritzke.workers.dev`  
**Format:** ES module — `export default { async fetch(request, env) {} }`

| Route | Proxies to |
|-------|------------|
| `POST /token` | S&P CapIQ auth endpoint |
| `POST /search` | S&P CapIQ search endpoint |
| `POST /xpx/token` | S&P Xpressapi token endpoint (with query-param injection) |
| `POST /xpx/search` | S&P Xpressapi search endpoint |
| `OPTIONS *` | CORS preflight |

CORS headers on all responses:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-SPX-Path
```

**Why proxy?** Chrome extensions cannot suppress the `Origin` header on `fetch()`. Some APIs (S&P) reject requests with a non-whitelisted `Origin`. The worker strips/rewrites headers before forwarding.

---

## UI Component Pattern

### Mount / self-init

```html
<!-- In popup HTML -->
<div id="credentials-root"></div>
<script src="PR_EXT_tree_compare.js"></script>
<!-- Script auto-mounts on DOMContentLoaded -->
```

### Template injection

The entire UI (CSS + HTML) lives as a template string `TEMPLATE` inside the IIFE. It is injected via `root.innerHTML = TEMPLATE`. This means the component is fully self-contained — no external stylesheets needed.

### Helper generators

```js
secretField(id, placeholder, hint)  // password input + eye toggle button
textField(id, placeholder, hint)    // plain text input
section(title, color, body)         // titled card wrapper
```

### `saveAndTest` pattern (used by every provider)

```js
async function saveAndTest(id, saveFn, testFn) {
  // 1. Save always runs first — test failure never blocks save
  await saveFn();
  // 2. Test runs after save succeeds
  const result = await testFn();
  toast(id, `✓ Saved & connected — ${result}`, 'ok');
  // On test failure: toast shows "✓ Saved — test failed: ..."
  // On save failure: returns early, no test attempted
}
```

### Toast system

```js
toast(id, message, type, durationMs)
// type: 'ok' | 'err' | 'info'
// Each provider section has its own <div class="creds-toast" id="toast-{id}">
```

### Copy All / Paste All

Credentials can be bulk-exported/imported via clipboard in pipe-separated `key:value|key:value` format:

```
intapp-host:myapp.intapp.com|intapp-client-id:ABC123|dnb-token:xyz...|sp-user:user@co.com
```

- Serialized with `CP_KEYS.map(k => `${k}:${el.value}`).join('|')`
- Parsed with `chunk.indexOf(':')` — splits on first colon only, so URLs/tokens with colons survive
- On paste: updates visible fields AND persists to `chrome.storage.local`
- Intapp fields merged with existing storage value before saving (partial paste support)

### Test All

Runs all 6 provider tests sequentially, shows results inline:
```
✅ Intapp: token received
✅ D&B: token received
✅ Geoapify: 1600 Pennsylvania Ave NW, Washington, DC 20500, United States
⬜ Moody's / BvD: not configured
❌ S&P Capital IQ: HTTP 401
✅ S&P Xpressapi: token received
```

---

## Background Message Types

The popup sends messages to background.js (not included in this extension, expected from host extension):

| Message type | Payload | Expected response |
|---|---|---|
| `TEST_INTAPP` | `{ creds: { appHost, clientId, clientSecret, redirectUri } }` | `{ ok: bool, error?: string, detail?: string }` |
| `TEST_DNB` | `{ token: string }` | `{ ok: bool, error?: string, detail?: string }` |

---

## Key Patterns to Reuse

1. **IIFE module with public API** — entire component in one file, no imports/exports needed
2. **`saveAndTest` separation** — save always succeeds independently of connectivity test; test failures shown distinctly
3. **Token expiry with buffer** — `expiresAt - 30000` (30s before actual expiry) to avoid races
4. **Clipboard import/export** — `key:value|key:value` format, split on first `:` to preserve URLs
5. **Shared proxy URL constant** — `const SP_PROXY = '...'` at top of file, used in both individual saves and Test All
6. **Self-contained CSS** — inject via `innerHTML`, scoped with `.creds-root *` prefix
7. **Field value restore** — `loadFields()` on mount fills all inputs from storage; safe: missing keys just leave inputs empty
8. **Eye toggle** — password fields paired with `<button data-target="{inputId}">` that toggles `input.type` between `password` / `text`
