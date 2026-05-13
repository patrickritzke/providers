# Providers — Combined Reference

Covers all three extensions: **credentials** (credential manager), **search-extension** (3rd Party Lookup), **tree-compare** (search + tree navigation). Providers: Intapp, D&B Direct+, Geoapify, Moody's/BvD Orbis, S&P Capital IQ, S&P Xpressapi.

---

## Table of Contents

1. [Credentials & Auth — General](#1-credentials--auth--general)
   - [CredentialsManager Component](#credentialsmanager-component)
   - [Copy All / Paste All](#copy-all--paste-all)
   - [Storage Keys](#storage-keys-canonical-schema)
   - [Cloudflare Worker Proxy](#cloudflare-worker-proxy)
2. [Auth — Per Provider](#2-auth--per-provider)
   - [Intapp](#intapp)
   - [D&B Direct+](#db-direct)
   - [Geoapify](#geoapify)
   - [Moody's / BvD Orbis](#moodys--bvd-orbis)
   - [S&P Capital IQ](#sp-capital-iq)
   - [S&P Xpressapi](#sp-xpressapi)
3. [Functions — Per Provider](#3-functions--per-provider)
   - [Moody's — Lookup & Match](#moodys--lookup--match)
   - [D&B — Search](#db--search)
   - [S&P Capital IQ — Search & Enrich](#sp-capital-iq--search--enrich)
   - [Cross-Provider Matching](#cross-provider-matching)
   - [API Call Logging](#api-call-logging)

---

## 1. Credentials & Auth — General

### CredentialsManager Component

A self-contained IIFE (`PR_EXT_credentials.js`) that renders a full credential management UI and exposes a storage API. Drop into any extension — no build step, no dependencies.

**Embed:**
```html
<div id="credentials-root"></div>
<script src="PR_EXT_credentials.js"></script>
<!-- auto-mounts on DOMContentLoaded -->
```

**Manifest requirements:**
```json
"permissions": ["storage", "clipboardRead", "clipboardWrite"],
"host_permissions": ["https://*/*"]
```

**Public API:**
```js
// Read credentials (anywhere — background, content, popup)
const { dnb_basic_token } = await CredentialsManager.get(['dnb_basic_token']);
const { intapp_credentials } = await CredentialsManager.get(['intapp_credentials']);
const { appHost, clientId, clientSecret } = intapp_credentials || {};

// Write / remove
await CredentialsManager.set({ geoapify_api_key: 'abc123' });
await CredentialsManager.remove(['spx_token']);

// Get a valid Xpressapi bearer (throws if missing or within 30s of expiry)
const token = await CredentialsManager.getSpxToken();
// throws: 'NO_SPX_TOKEN' | 'SPX_TOKEN_EXPIRED'
```

Or bypass the component entirely — all keys are plain `chrome.storage.local`:
```js
const { sp_username, sp_password } = await chrome.storage.local.get(['sp_username', 'sp_password']);
```

**`saveAndTest` pattern** — used by every Save & Test button:
```js
async function saveAndTest(id, saveFn, testFn) {
  await saveFn();          // save ALWAYS runs first; on failure returns early
  const result = await testFn();
  // test failure → "✓ Saved — test failed: ..."
  // test success → "✓ Saved & connected — {result}"
}
```

**Token expiry pattern (Xpressapi):**
```js
if (Date.now() >= spx_token.expiresAt - 30000) throw new Error('SPX_TOKEN_EXPIRED');
// 30-second buffer before actual expiry
```

---

### Copy All / Paste All

Bulk credential transfer between extensions or browser profiles via clipboard. Users enter credentials once in the credentials extension, then paste into any other extension that embeds the component.

**Clipboard format:** pipe-separated `field-id:value` pairs
```
intapp-host:myapp.intapp.com|intapp-client-id:ABC123|dnb-token:dGVzdA==|sp-user:user@co.com
```

**Field IDs** (hyphens — different namespace from storage keys which use underscores):
```
intapp-host, intapp-tenant, intapp-client-id, intapp-secret, intapp-redirect
dnb-token
geoapify-key
moodys-user, moodys-pass
sp-user, sp-pass
spx-user, spx-pass
```

**Copy:** serializes all non-empty visible field values.  
**Paste:** parses → updates visible fields → persists to `chrome.storage.local`. Splits on *first* `:` only so URLs and base64 tokens survive. Intapp fields merge with existing stored object (partial paste is safe).

---

### Storage Keys (Canonical Schema)

All in `chrome.storage.local`. Shared across all extensions that embed the component.

| Key | Type | Description |
|-----|------|-------------|
| `intapp_credentials` | `{ appHost, tenantId, clientId, clientSecret, redirectUri }` | Intapp OAuth2 config |
| `intapp_token` | `{ token, expiresAt }` | Cached bearer — managed by host extension background |
| `dnb_basic_token` | `string` | Pre-encoded `btoa('key:secret')` |
| `geoapify_api_key` | `string` | Raw API key |
| `moodys_username` | `string` | BvD/Orbis login |
| `moodys_password` | `string` | BvD/Orbis password |
| `moodys_base_url` | `string` | Optional BvD endpoint override |
| `sp_username` | `string` | S&P Capital IQ username |
| `sp_password` | `string` | S&P Capital IQ password |
| `spx_username` | `string` | S&P Xpressapi username |
| `spx_password` | `string` | S&P Xpressapi password |
| `spx_token` | `{ access_token, refresh_token, expiresAt }` | Cached Xpressapi bearer |
| `api_logs` | `LogEntry[]` | Rolling API call log, max 100, newest first |
| `search_history` | `string[]` | Last 10 search terms, newest first |

---

### Cloudflare Worker Proxy

**URL:** `https://delicate-union-802c.patrickritzke.workers.dev`  
**File:** `PR_EXT_credentials_worker.js`  
**Deploy format:** ES module — `export default { async fetch(request) {} }` (legacy `addEventListener('fetch')` causes silent failures)

Required because Chrome extensions cannot suppress the `Origin` header, and S&P rejects requests with a browser origin. D&B, Geoapify, and BvD allow direct requests.

| Route | Purpose |
|-------|---------|
| `POST /token` | S&P CapIQ auth |
| `POST /search` | S&P CapIQ search |
| `POST /xpx/token` | Xpressapi token (injects query params + `Authorization: Basic `) |
| `POST /xpx/search` | Xpressapi search (reads `X-SPX-Path` header) |
| `OPTIONS *` | CORS preflight → 204 |

All responses include:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-SPX-Path, Cache-Control, Accept
```

---

## 2. Auth — Per Provider

### Intapp

**Type:** OAuth2 `client_credentials`  
**Direct — no proxy needed**

```
POST https://{appHost}/auth/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id={clientId}
&client_secret={clientSecret}
&redirect_uri={redirectUri}
```

- `appHost` stored without protocol — stripped on save: `.replace(/^https?:\/\//, '')`
- Response: `{ access_token, refresh_token, expires_in }`
- Test via background message: `{ type: 'TEST_INTAPP', creds: { appHost, clientId, clientSecret, redirectUri } }` → `{ ok, error?, detail? }`

---

### D&B Direct+

**Type:** OAuth2 `client_credentials` with pre-encoded Basic token  
**Direct — no proxy needed**

```
POST https://plus.dnb.com/v2/token
Authorization: Basic {dnb_basic_token}
Content-Type: application/json

{ "grant_type": "client_credentials" }
```

- `dnb_basic_token` = `btoa('API_key:API_secret')` — user pre-computes this; stored as-is
- Response: `{ access_token, expiresIn, tokenType }`
- Token is **not cached** to storage — fetched fresh per session
- Test via background message: `{ type: 'TEST_DNB', token }` → `{ ok, error?, detail? }`

---

### Geoapify

**Type:** API key as query parameter  
**Direct — no proxy needed**

```
GET https://api.geoapify.com/v1/geocode/search?text={query}&apiKey={geoapify_api_key}
```

- No token exchange — key appended to every request URL
- Free tier: 3,000 req/day
- Test probe: `'1600 Pennsylvania Ave, Washington DC'`
- Success check: `data.features[0].properties.formatted` is non-empty

---

### Moody's / BvD Orbis

**Type:** SOAP 1.1 session-based  
**Endpoint:** `https://webservices.bvdinfo.com/v1.3/orbis4/remoteaccess.asmx` (hardcoded; `moodys_base_url` overrides in search-extension)  
**Direct — no proxy needed**

**Step 1 — Open (get session ID):**
```
POST {endpoint}
Content-Type: text/xml; charset=utf-8
SOAPAction: http://bvdep.com/webservices/Open
```
```xml
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

Extract session ID:
```js
const sid = text.match(/<OpenResult>(.*?)<\/OpenResult>/)?.[1];
// On failure: text.match(/<faultstring>(.*?)<\/faultstring>/)?.[1]
```

- Sessions are **not cached** — call Open before each use
- 403 = bad credentials (request format is correct)

---

### S&P Capital IQ

**Type:** Basic → Bearer  
**Must use proxy** (browser origin blocked by S&P)

```
POST https://delicate-union-802c.patrickritzke.workers.dev/token
Authorization: Basic {btoa(username:password)}
Content-Type: application/x-www-form-urlencoded
Accept: */*

username={username}&password={password}
```

Proxy forwards to: `https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/authenticate/api/v1/token`

- Response: `{ access_token, expires_in_seconds, ... }`
- **Token caching pattern:**
```js
const expiresIn = parseInt(data.expires_in_seconds || '3500', 10);
_spTokenCache = {
  accessToken: data.access_token,
  expiresAt: Date.now() + (expiresIn - 60) * 1000,  // 60s buffer
};
// Invalidate on 401: _spTokenCache = null
```

---

### S&P Xpressapi

**Type:** Credentials as URL query params — non-standard  
**Must use proxy**

Extension sends to proxy:
```
POST {proxy}/xpx/token
Content-Type: application/json

{ "username": "...", "password": "..." }
```

Proxy reconstructs the actual Xpressapi request:
```
POST https://xpressapi.marketplace.spglobal.com/authenticate/api/v1/token
     ?username={username}&password={password}    ← credentials as URL query params
Authorization: Basic                              ← trailing space, NO value after it
Content-Type: application/x-www-form-urlencoded

{ "grant_type" : "client_credentials" }          ← JSON string despite form-encoded CT
```

> **Critical:** `Authorization: Basic ` with a trailing space and nothing after it. Standard `Basic btoa(...)` is rejected. Body is a literal JSON-looking string despite `Content-Type: application/x-www-form-urlencoded`. Verified via Postman.

Response: `{ access_token, refresh_token, expires_in_seconds, scope, token_type }`

Token stored as:
```js
{ access_token, refresh_token: data.refresh_token || null, expiresAt: Date.now() + (expires_in_seconds || 3600) * 1000 }
```

Search requests (via proxy):
```
POST {proxy}/xpx/search
Authorization: Bearer {access_token}
X-SPX-Path: /the/api/path          ← required; worker appends to Xpressapi base URL
Content-Type: application/json
```

---

## 3. Functions — Per Provider

### Moody's — Lookup & Match

Two sequential SOAP calls. All requests use `Logger.trackedSoapCall` for automatic logging.

**SOAP helpers:**
```js
function escXml(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function xmlTag(xml, tag) {
  // namespace-agnostic: handles tags with or without prefix (web:Name, ns0:Name, Name)
  const m = xml.match(new RegExp(
    `<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\/(?:[^:>]+:)?${tag}>`, 'i'
  ));
  return m ? m[1].trim() : '';
}
```

**Match SOAP request:**
```
SOAPAction: http://bvdep.com/webservices/Match
```
```xml
<web:Match>
  <web:sessionHandle>{sessionId}</web:sessionHandle>
  <web:criteria>
    <web:Name>{company name}</web:Name>
    <web:Address></web:Address>
    <web:PostCode></web:PostCode>
    <web:City></web:City>
    <web:Country></web:Country>
    <web:PhoneOrFax></web:PhoneOrFax>
    <web:EMailOrWebsite></web:EMailOrWebsite>
    <web:NationalId></web:NationalId>
    <web:Ticker></web:Ticker>
    <web:Isin></web:Isin>
    <web:State></web:State>
    <web:BvD9></web:BvD9>
  </web:criteria>
  <web:exclusionFlags></web:exclusionFlags>
</web:Match>
```

**Parsing results:**
```js
const re = /<(?:[^:>]+:)?MatchResult[^>]*>([\s\S]*?)<\/(?:[^:>]+:)?MatchResult>/gi;
let m;
while ((m = re.exec(matchXml)) !== null) {
  const b = m[1];
  results.push({
    id:       xmlTag(b, 'BvDID'),
    name:     xmlTag(b, 'Name'),
    address:  xmlTag(b, 'Address'),
    postCode: xmlTag(b, 'PostCode'),
    city:     xmlTag(b, 'City'),
    country:  xmlTag(b, 'Country'),
    website:  xmlTag(b, 'EMailOrWebsite'),
    ticker:   xmlTag(b, 'Ticker'),
    isin:     xmlTag(b, 'ISIN'),
    lei:      xmlTag(b, 'LEI'),
  });
}
```

**Normalized candidate shape** (common across all providers):
```js
{ id, name, location, website, ticker, isin, lei }
// Moody's also keeps raw: address, postCode, city, country
// location is built from these when rendering
```

---

### D&B — Search

**Two calls:** token → search.

**Search request:**
```
POST https://plus.dnb.com/v1/search/criteria
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "searchTerm": "{company name}",
  "isStandalone": false,
  "pageSize": 50,
  "pageNumber": 1
}
```

**Response → candidate:**
```js
const org = candidate.organization;
const addr = org.primaryAddress || {};
const loc = [
  addr.streetAddress?.line1,
  addr.postalCode,
  addr.addressLocality?.name,
  addr.addressRegion?.abbreviatedName,
  addr.addressCountry?.isoAlpha2Code
].filter(Boolean).join(', ');

{
  id:       org.duns,
  name:     org.primaryName,
  location: loc,
  website:  org.domain,
  ticker:   org.tickerSymbol,
  isin:     '',
  lei:      '',
}
```

---

### S&P Capital IQ — Search & Enrich

**Two calls:** quick match (names + IDs) → enrich (per-ID detail).

**Quick match request:**
```js
{
  inputRequests: [
    { function: 'GDSHE', identifier: companyName, mnemonic: 'IQ_COMPANY_NAME_QUICK_MATCH',
      properties: { startDate: '2024-01-01', endRank: '50' } },
    { function: 'GDSHE', identifier: companyName, mnemonic: 'IQ_COMPANY_ID_QUICK_MATCH',
      properties: { startDate: '2024-01-01', endRank: '50' } },
  ]
}
```

**Quick match response:**
```js
const responses = data.GDSSDKResponse;
const nameRows = responses[0].Rows;  // [{ Row: ['Company A'] }, ...]
const idRows   = responses[1].Rows;  // [{ Row: ['12345'] }, ...]
// names[i] and ids[i] align by index
```

**Enrich request** (batched for all IDs in one call):
```js
{
  inputRequests: [
    ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COMPANY_TICKER',  properties: {} })),
    ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COMPANY_WEBSITE', properties: {} })),
    ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COMPANY_ADDRESS', properties: {} })),
    ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COUNTRY_NAME',    properties: {} })),
  ]
}
```

**Enrich response layout** (`n` = number of IDs):
```js
const er = data.GDSSDKResponse;
const getVal = b => b?.Rows?.[0]?.Row?.[0] || '';
// er[0..n-1]     → tickers
// er[n..2n-1]    → websites
// er[2n..3n-1]   → addresses
// er[3n..4n-1]   → countries
for (let i = 0; i < n; i++) {
  results[i].ticker   = getVal(er[i]);
  results[i].website  = getVal(er[n+i]);
  results[i].location = [getVal(er[2*n+i]), getVal(er[3*n+i])].filter(Boolean).join(', ');
}
```

**Ticker format:** may include exchange prefix — `"NasdaqGS:SBUX"`. Split on `:` to separate exchange and symbol for display.

Enrichment failures are non-fatal — search results still returned without detail fields.

---

### Cross-Provider Matching

Used in the search-extension to correlate results from multiple providers into a single matched view.

**Exact match keys** (checked in order): `ticker`, `isin`, `lei`  
**Squishy match keys** (user-toggled): `website` (strip protocol/www/path), `address` (first two components, lowercased)

**Normalization:**
```js
function normaliseWebsite(w) {
  return (w||'').replace(/^https?:\/\//i,'').replace(/^www\./i,'').replace(/\/.*$/,'').toLowerCase().trim();
}
function normaliseAddress(a) {
  return (a||'').toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}
```

**Algorithm:**
1. For each match key, build an index per provider: `{ normalizedValue → arrayIndex }`
2. Find values that appear in 2+ providers
3. Deduplicate by `sig` = joined indexes (e.g. `"0:2:-"` = moodys[0] + dnb[2] + no sp)
4. Track used indexes; remainder surfaces as unmatched count per provider

**Match row shape:**
```js
{
  key:    'TICKER' | 'ISIN' | 'LEI' | 'Website' | 'Address',
  val:    string,           // the matched value
  sig:    string,           // e.g. '0:2:-'
  type:   'exact' | 'squishy',
  moodys: Candidate | null,
  dnb:    Candidate | null,
  sp:     Candidate | null,
}
```

**Ticker matching note:** strip exchange prefix before indexing — `"NasdaqGS:SBUX"` → `"SBUX"` so it matches `"SBUX"` from another provider.

---

### API Call Logging

Logger utility (from `logger.js`) stores all API calls in `chrome.storage.local` under `api_logs`. Max 100 entries, newest first.

**Log entry shape:**
```js
{
  id:           string,   // timestamp-based ID
  timestamp:    string,   // ISO string
  action:       string,   // e.g. 'http://bvdep.com/webservices/Open', 'D&B Token'
  url:          string,
  requestBody:  string,
  status:       number | null,
  responseBody: string | null,
  durationMs:   number | null,
  error:        string | null,
  pending:      boolean,
}
```

**API:**
```js
Logger.add(entry)                           // prepend, trim to 100
Logger.getAll()                             // returns full array
Logger.clear()                              // removes all
Logger.trackedSoapCall(url, action, body)   // wraps SOAP fetch, auto-logs req+res
Logger._updateEntry(id, updates)            // patches a pending entry on completion
```

**Manual logging pattern (non-SOAP):**
```js
const logId = Date.now().toString(36);
await Logger.add({ id: logId, timestamp: new Date().toISOString(), action: 'D&B Token',
  url: DNB_TOKEN_URL, requestBody: body, status: null, responseBody: null,
  durationMs: null, error: null, pending: true });
const t0 = performance.now();
const res = await fetch(...);
const text = await res.text();
await Logger._updateEntry(logId, { status: res.status, responseBody: text,
  durationMs: Math.round(performance.now() - t0), pending: false });
```

---

## Known Gotchas

| # | Gotcha |
|---|--------|
| 1 | **Xpressapi auth** — `Authorization: Basic ` with trailing space, no value. Body is a JSON-looking string with `Content-Type: application/x-www-form-urlencoded`. This is what Xpressapi expects (verified via Postman). |
| 2 | **BvD is SOAP, not REST** — `webservices.bvdinfo.com` (Orbis SOAP). `api.bvdinfo.com` is a separate REST product with different credentials. 403 from SOAP = bad credentials. |
| 3 | **S&P proxy required** — direct browser requests to S&P auth/search are blocked by CORS. BvD, D&B, and Geoapify allow direct requests. |
| 4 | **Worker ES module format** — `export default { async fetch() }` required. Legacy `addEventListener('fetch')` causes silent failures in modern Cloudflare Workers. |
| 5 | **D&B token is pre-encoded** — user computes `btoa('key:secret')` themselves. No separate key/secret fields stored. |
| 6 | **Intapp appHost — no protocol** — store subdomain only (e.g. `myapp.intapp.com`); prepend `https://` when building token URL. Entering `https://...` results in double-protocol URL. |
| 7 | **Copy All field IDs use hyphens** — `intapp-host` in clipboard format, `intapp_credentials.appHost` in storage. Two separate namespaces; do not conflate. |
| 8 | **S&P enrich response layout** — offsets are `[0..n-1]` tickers, `[n..2n-1]` websites, `[2n..3n-1]` addresses, `[3n..4n-1]` countries. `n` = number of IDs in the batch. |
| 9 | **XML namespace-agnostic parsing** — BvD response tags may or may not carry a namespace prefix. Use regex `<(?:[^:>]+:)?TagName[^>]*>` to match both `<TagName>` and `<web:TagName>`. |
