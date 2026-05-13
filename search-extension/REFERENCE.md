# 3rd Party Lookup Extension — Reference Document

A Chrome extension (Manifest V3) that searches Moody's (BvD/Orbis), D&B, and S&P Capital IQ simultaneously for company IDs. This document captures every API, data shape, logic pattern, and UI convention in the codebase for use as a build reference.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Storage Schema](#storage-schema)
3. [Provider APIs](#provider-apis)
   - [Moody's (BvD/Orbis)](#moodys-bvdorbis)
   - [D&B](#db)
   - [S&P Capital IQ](#sp-capital-iq)
4. [Cross-Provider Matching](#cross-provider-matching)
5. [Logger](#logger)
6. [UI Patterns](#ui-patterns)
7. [Background Service Worker](#background-service-worker)

---

## Architecture Overview

```
popup.html / popup.js        — Main UI: search, results, settings panel
options.html / options.js    — Standalone settings page (same fields as popup panel)
background.js                — Service worker: handles S&P calls to avoid CORS, token cache
logger.js                    — Shared logging utility, writes to chrome.storage.local
log.html / log.js            — API log viewer (opens in a tab)
```

**Why background.js for S&P?**  
S&P's auth endpoint doesn't allow CORS from the popup context. S&P calls are posted as a job to `chrome.storage.local` (`SP_JOB`), the background worker picks them up, calls the API (or a Cloudflare Worker proxy), and writes the result back to `SP_RESULT`. Moody's and D&B are called directly from popup.js.

**Cloudflare Worker proxy (`SP_PROXY_URL`):**  
`https://delicate-union-802c.patrickritzke.workers.dev`  
Routes `/token` → S&P auth endpoint, `/search` → S&P GDS search endpoint.  
The proxy exists solely to add CORS headers. In a non-extension context (Node, web app with a backend) the proxy is unnecessary.

---

## Storage Schema

All state lives in `chrome.storage.local`. Keys:

| Key | Type | Description |
|-----|------|-------------|
| `moodys_username` | string | Moody's BvD username |
| `moodys_password` | string | Moody's BvD password |
| `moodys_base_url` | string | Override for SOAP endpoint (optional, falls back to default) |
| `dnb_basic_token` | string | D&B pre-encoded Basic token (base64 of `key:secret`) |
| `sp_username` | string | S&P Capital IQ username |
| `sp_password` | string | S&P Capital IQ password |
| `api_logs` | LogEntry[] | Rolling array of API call logs, max 100, newest first |
| `search_history` | string[] | Last 10 search terms, newest first |
| `SP_JOB` | SpJob | Background job posted by popup for S&P search |
| `SP_RESULT` | SpResult | Result written back by background worker |

**SpJob shape:**
```js
{ jobId: string, status: 'pending', name: string, username: string, password: string }
```

**SpResult shape:**
```js
{ jobId: string, results?: Candidate[], error?: string, tokenLog: LogEntry, searchLog: LogEntry }
```

---

## Provider APIs

### Candidate (common result shape)

All three providers normalize results to this shape:

```js
{
  id:       string,   // BvDID | DUNS | IQ CompanyId
  name:     string,   // company name
  location: string,   // formatted address string (built differently per provider)
  website:  string,
  ticker:   string,   // may include exchange prefix e.g. "NasdaqGS:SBUX"
  isin:     string,
  lei:      string,
}
```

Moody's also returns raw address fields before normalization:
```js
{ address, postCode, city, country }  // used alongside location
```

---

### Moody's (BvD/Orbis)

**Protocol:** SOAP over HTTPS  
**Default endpoint:** `https://webservices.bvdinfo.com/v1.3/orbis4/remoteaccess.asmx`  
**Configurable:** yes — user can override with a custom base URL

**Flow:** Two sequential SOAP calls — `Open` (get session ID) then `Match` (search by name).

#### Open request

SOAPAction: `http://bvdep.com/webservices/Open`

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:web="http://bvdep.com/webservices/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:Open>
      <web:username>USERNAME</web:username>
      <web:password>PASSWORD</web:password>
    </web:Open>
  </soapenv:Body>
</soapenv:Envelope>
```

**Response:** Extract `<OpenResult>` — this is the session handle (string).  
On failure: `<faultstring>` contains the error message.

#### Match request

SOAPAction: `http://bvdep.com/webservices/Match`

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:web="http://bvdep.com/webservices/">
  <soapenv:Header/>
  <soapenv:Body>
    <web:Match>
      <web:sessionHandle>SESSION_HANDLE</web:sessionHandle>
      <web:criteria>
        <web:Name>COMPANY NAME</web:Name>
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
  </soapenv:Body>
</soapenv:Envelope>
```

**Response:** Zero or more `<MatchResult>` blocks. Each contains:

| XML Tag | Maps to |
|---------|----------|
| `BvDID` | `id` |
| `Name` | `name` |
| `Address` | `address` |
| `PostCode` | `postCode` |
| `City` | `city` |
| `Country` | `country` |
| `EMailOrWebsite` | `website` |
| `Ticker` | `ticker` |
| `ISIN` | `isin` |
| `LEI` | `lei` |

**XML parsing helpers:**

```js
function escXml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(
    `<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, 'i'
  ));
  return m ? m[1].trim() : '';
}
```

The namespace-agnostic regex (`(?:[^:>]+:)?`) handles responses where tags may or may not carry a namespace prefix.

---

### D&B

**Protocol:** REST/JSON  
**Auth endpoint:** `https://plus.dnb.com/v2/token`  
**Search endpoint:** `https://plus.dnb.com/v1/search/criteria`  
**Auth type:** OAuth2 client credentials — user stores a pre-encoded Basic token (base64 of `API_key:API_secret`)

**Flow:** POST token → POST search.

#### Token request

```
POST https://plus.dnb.com/v2/token
Authorization: Basic <dnb_basic_token>
Content-Type: application/json

{ "grant_type": "client_credentials" }
```

**Response:** `{ access_token: string, ... }`

#### Search request

```
POST https://plus.dnb.com/v1/search/criteria
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "searchTerm": "COMPANY NAME",
  "isStandalone": false,
  "pageSize": 50,
  "pageNumber": 1
}
```

**Response shape (relevant fields):**

```js
{
  searchCandidates: [
    {
      organization: {
        duns: string,
        primaryName: string,
        domain: string,
        tickerSymbol: string,
        primaryAddress: {
          streetAddress: { line1: string },
          postalCode: string,
          addressLocality: { name: string },
          addressRegion: { abbreviatedName: string },
          addressCountry: { isoAlpha2Code: string },
        }
      }
    }
  ]
}
```

**Location string built as:**
```js
[line1, postalCode, city, regionAbbrev, countryCode].filter(Boolean).join(', ')
```

---

### S&P Capital IQ

**Protocol:** REST/JSON  
**Auth endpoint:** `https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/authenticate/api/v1/token`  
**Search endpoint:** `https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/v3/clientservice.json`  
**Auth type:** Basic (username:password) → Bearer token with expiry  
**CORS issue:** Must be proxied in browser contexts (see Cloudflare Worker above)

**Flow:** POST token (cached) → POST search (name + ID mnemonics) → POST enrich (detail mnemonics per ID).

#### Token request

```
POST /token  (via proxy, or directly to SP_AUTH_URL)
Authorization: Basic <base64(username:password)>
Content-Type: application/x-www-form-urlencoded

username=USERNAME&password=PASSWORD
```

**Response:** `{ access_token: string, expires_in_seconds: string, ... }`

**Token caching:**
```js
const expiresIn = parseInt(data.expires_in_seconds || '3500', 10);
_spTokenCache = {
  accessToken: data.access_token,
  expiresAt: Date.now() + (expiresIn - 60) * 1000,
};
if (!_spTokenCache || _spTokenCache.expiresAt <= Date.now() + 30000) { /* re-auth */ }
```

On 401 from search: clear `_spTokenCache = null` and re-auth on next call.

#### Search request — name + ID quick match

```json
{
  "inputRequests": [
    { "function": "GDSHE", "identifier": "COMPANY NAME", "mnemonic": "IQ_COMPANY_NAME_QUICK_MATCH", "properties": { "startDate": "2024-01-01", "endRank": "50" } },
    { "function": "GDSHE", "identifier": "COMPANY NAME", "mnemonic": "IQ_COMPANY_ID_QUICK_MATCH",   "properties": { "startDate": "2024-01-01", "endRank": "50" } }
  ]
}
```

**Response shape:**
```js
{
  GDSSDKResponse: [
    { Rows: [{ Row: ["Company Name A"] }, ...] },  // [0] names
    { Rows: [{ Row: ["12345"] },          ...] },  // [1] IDs
  ]
}
```

Names and IDs align by index: `names[i]` ↔ `ids[i]`.

#### Enrich request — detail per company ID

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

**Response layout** (`n` = number of IDs):
- `er[0..n-1]` → tickers
- `er[n..2n-1]` → websites
- `er[2n..3n-1]` → addresses
- `er[3n..4n-1]` → countries

Each block: `block.Rows[0].Row[0]` is the value (or empty/null).

**Ticker format:** May include exchange prefix e.g. `"NasdaqGS:SBUX"`. Split on `:` to separate exchange and symbol.

---

## Cross-Provider Matching

**Exact match keys** (checked in order): `ticker`, `isin`, `lei`  
**Squishy match keys** (optional, user-toggled): `website` (strip protocol/www/path), `address` (first two components, lowercased)

**Algorithm:**
- For each key, build an index per provider: `{ value → arrayIndex }`
- Find values that appear in 2+ providers
- Group into match rows with a `sig` (joined indexes) to deduplicate
- Track used indexes; remaining counts surface as an unmatched note

**Match row shape:**
```js
{ key: string, val: string, sig: string, type: 'exact'|'squishy', moodys: Candidate|null, dnb: Candidate|null, sp: Candidate|null }
```

---

## Logger

**Log entry shape:**
```js
{ id, timestamp, action, url, requestBody, status, responseBody, durationMs, error, pending }
```

**API:**
```js
Logger.add(entry)                         // prepend, trim to 100
Logger.getAll()                           // returns full array
Logger.clear()                            // removes all
Logger.trackedSoapCall(url, action, body) // wraps SOAP fetch, logs req+res
Logger._updateEntry(id, updates)          // patches a pending entry
```

---

## UI Patterns

**Design tokens (CSS vars):** `--bvd: #3d5afe`, `--dnb: #c0501a`, `--sp: #0a7c3e`, `--match: #6d28d9`, `--danger: #d93025`  
**Fonts:** IBM Plex Sans (UI), IBM Plex Mono (IDs, labels, meta). Log viewer uses DM Mono + Syne.

**Provider selector:** Pills (All / Moody's / D&B / S&P). Hidden if only one provider configured. Disabled + "no creds" message if none.

**Tabs:** Built dynamically. Panels: `panelMatched`, `panelMoodys`, `panelDnb`, `panelSp`. Count badges per tab.

**Cards:** Click to copy ID to clipboard + toast. Meta row shows only fields with values. Ticker split on `:` → market + symbol chips.

**Pagination:** Client-side, page sizes 5/10/25/50. Ellipsis gaps. Provider-colored active state.

**Settings:** Slide-in panel in popup + standalone options page. Save/Clear per provider. Status indicators (✓ Set / Not set). Flash messages auto-clear.

**Search history:** Last 10 terms in `search_history`. Dropdown on focus/type. Individual delete. Click to fill + search.

**Log viewer:** Dark theme (`--bg: #0b0c10`). Two-panel: list left, detail right. Auto-refresh every 3s. XML syntax highlighting on req/res bodies.

---

## Background Service Worker

**Keep-alive:** `chrome.alarms` every 0.4 min.  
**S&P job polling:** `setInterval(pollForJobs, 1000)` — picks up `SP_JOB`, processes one at a time, writes `SP_RESULT`.  
**Token cache:** Module-level `_spTokenCache` in background.js (separate from popup.js instance).  
**`safeDecodeURI`:** Safely decodes URI-encoded credentials without throwing.

---

## Manifest Permissions

```json
{
  "permissions": ["storage", "tabs", "alarms"],
  "host_permissions": [
    "https://webservices.bvdinfo.com/*",
    "https://plus.dnb.com/*",
    "https://api-ciq.marketintelligence.spglobal.com/*"
  ]
}
```
