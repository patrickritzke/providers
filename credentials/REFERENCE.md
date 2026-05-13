# credentials — Reference

**Extension:** PR_EXT_credentials v1.1.4  
**Role:** Canonical credential manager. Users enter credentials here once. Every other extension reads from the same `chrome.storage.local` keys.

Two files matter:
- `PR_EXT_credentials.js` — all logic, UI, and storage. Self-contained IIFE.
- `PR_EXT_credentials_worker.js` — Cloudflare Worker proxy for S&P APIs.

---

## Embedding in Another Extension

```html
<!-- popup.html or options.html -->
<div id="credentials-root"></div>
<script src="PR_EXT_credentials.js"></script>
<!-- auto-mounts on DOMContentLoaded -->
```

Manifest requirements:
```json
"permissions": ["storage", "clipboardRead", "clipboardWrite"],
"host_permissions": ["https://*/*"]
```

Or open as a dedicated page from any popup:
```js
chrome.runtime.openOptionsPage();
// manifest: "options_page": "PR_EXT_credentials.html"
```

---

## Reading Credentials

```js
// Via CredentialsManager (if the JS is included)
const { dnb_basic_token } = await CredentialsManager.get(['dnb_basic_token']);

// Or directly from storage anywhere (background.js, content.js, popup.js)
const { sp_username, sp_password } = await chrome.storage.local.get(['sp_username', 'sp_password']);

// Intapp (stored as an object)
const { intapp_credentials } = await chrome.storage.local.get(['intapp_credentials']);
const { appHost, clientId, clientSecret, redirectUri } = intapp_credentials || {};

// Xpressapi bearer token with expiry check
const token = await CredentialsManager.getSpxToken();
// throws 'NO_SPX_TOKEN' or 'SPX_TOKEN_EXPIRED' if not ready
```

---

## Storage Keys (Canonical Schema)

All in `chrome.storage.local`. These are the authoritative key names used across all extensions.

| Key | Type | Description |
|-----|------|-------------|
| `intapp_credentials` | `{ appHost, tenantId, clientId, clientSecret, redirectUri }` | Intapp OAuth2 config |
| `intapp_token` | `{ token, expiresAt }` | Cached bearer — managed by host extension background, not this UI |
| `dnb_basic_token` | `string` | Pre-encoded `btoa('key:secret')` from D&B Direct+ portal |
| `geoapify_api_key` | `string` | Raw API key |
| `moodys_username` | `string` | BvD/Orbis login |
| `moodys_password` | `string` | BvD/Orbis password |
| `moodys_base_url` | `string` | Optional BvD endpoint override (falls back to hardcoded URL if absent) |
| `sp_username` | `string` | S&P Capital IQ username |
| `sp_password` | `string` | S&P Capital IQ password |
| `spx_username` | `string` | S&P Xpressapi username |
| `spx_password` | `string` | S&P Xpressapi password |
| `spx_token` | `{ access_token, refresh_token, expiresAt }` | Cached Xpressapi bearer — set after successful Test |

---

## Copy All / Paste All

The key portability feature. Lets users move all credentials between extensions (or browser profiles) via clipboard.

**Format:** pipe-separated `field-id:value` pairs
```
intapp-host:myapp.intapp.com|intapp-client-id:ABC123|dnb-token:base64...|sp-user:user@co.com
```

**Field IDs** (used in clipboard format — note hyphens, not underscores):
```
intapp-host, intapp-tenant, intapp-client-id, intapp-secret, intapp-redirect
dnb-token
geoapify-key
moodys-user, moodys-pass
sp-user, sp-pass
spx-user, spx-pass
```

**Copy:** serializes all non-empty visible fields to clipboard.  
**Paste:** parses clipboard → updates visible fields → persists to `chrome.storage.local`. Intapp fields merge with existing storage (partial paste is safe). Splits on first `:` only, so URLs and base64 tokens with colons survive.

---

## Provider Auth Details

### Intapp — OAuth2 `client_credentials`

```
POST https://{appHost}/auth/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id={clientId}&client_secret={clientSecret}&redirect_uri={redirectUri}
```

- `appHost` = subdomain only, no `https://` (stripped on save)
- Response: standard OAuth2 `{ access_token, refresh_token, expires_in }`

### D&B Direct+ — pre-encoded Basic → bearer

```
POST https://plus.dnb.com/v2/token
Authorization: Basic {dnb_basic_token}
Content-Type: application/json

{ "grant_type": "client_credentials" }
```

- User provides `btoa('key:secret')` pre-encoded — no separate key/secret fields
- No proxy needed

### Geoapify — API key as query param

```
GET https://api.geoapify.com/v1/geocode/search?text={query}&apiKey={geoapify_api_key}
```

- No token exchange, no proxy
- Free tier: 3,000 req/day

### Moody's / BvD (Orbis) — SOAP session

```
POST https://webservices.bvdinfo.com/v1.3/orbis4/remoteaccess.asmx
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

- Response: `<OpenResult>R1|{sessionId}</OpenResult>` — extract with regex
- Sessions not cached; call Open before each use
- No proxy needed; 403 = bad credentials

### S&P Capital IQ — Basic → bearer via proxy

```
POST https://delicate-union-802c.patrickritzke.workers.dev/token
Authorization: Basic {btoa(username:password)}
Content-Type: application/x-www-form-urlencoded

username={username}&password={password}
```

- Proxy required (S&P rejects browser `Origin` header)
- Forwards to `https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/authenticate/api/v1/token`

### S&P Xpressapi — unusual auth (credentials as query params)

Extension sends `{ username, password }` JSON to proxy. Worker reconstructs:

```
POST https://xpressapi.marketplace.spglobal.com/authenticate/api/v1/token
     ?username={username}&password={password}
Authorization: Basic        ← trailing space, NO value
Content-Type: application/x-www-form-urlencoded

{ "grant_type" : "client_credentials" }    ← JSON string, despite form-encoded CT
```

- `Authorization: Basic ` with trailing space and no token — anything else is rejected
- Token stored as `{ access_token, refresh_token, expiresAt }` with 30s expiry buffer
- `getSpxToken()` throws before expiry to give callers time to refresh

---

## Cloudflare Worker

**URL:** `https://delicate-union-802c.patrickritzke.workers.dev`  
**Deploy format:** ES module — `export default { async fetch(request) {} }` (not legacy `addEventListener`)

| Route | Purpose |
|-------|---------|
| `POST /token` | S&P CapIQ auth |
| `POST /search` | S&P CapIQ search |
| `POST /xpx/token` | Xpressapi token (injects query params + `Authorization: Basic `) |
| `POST /xpx/search` | Xpressapi search (reads `X-SPX-Path` header for API path) |
| `OPTIONS *` | CORS preflight → 204 |

---

## Known Gotchas

| # | Gotcha |
|---|--------|
| 1 | **Xpressapi auth** — `Authorization: Basic ` with trailing space, no value. Body is a JSON-looking string with `Content-Type: application/x-www-form-urlencoded`. This is what Xpressapi expects. |
| 2 | **BvD is SOAP** — `webservices.bvdinfo.com` (SOAP). `api.bvdinfo.com` is a different REST product. 403 = bad credentials, correct request format. |
| 3 | **D&B token is pre-encoded** — user must compute `btoa('key:secret')` themselves before entering it. |
| 4 | **Intapp appHost — no protocol** — store subdomain only; extension prepends `https://` when building token URL. |
| 5 | **Copy All key names use hyphens** — `intapp-host` in clipboard, `intapp_credentials.appHost` in storage. Two separate namespaces. |
| 6 | **Worker ES module format** — `export default { async fetch() }` required. Legacy `addEventListener('fetch')` causes silent failures. |
