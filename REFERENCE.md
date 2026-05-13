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
|---------|---------|
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
        domain: string,          // website
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
  expiresAt: Date.now() + (expiresIn - 60) * 1000,  // 60s safety buffer
};
// Check before use:
if (!_spTokenCache || _spTokenCache.expiresAt <= Date.now() + 30000) { /* re-auth */ }
```

On 401 from search: clear `_spTokenCache = null` and re-auth on next call.

#### Search request — name + ID quick match

```
POST /search  (via proxy, or directly to SP_SEARCH_URL)
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "inputRequests": [
    {
      "function": "GDSHE",
      "identifier": "COMPANY NAME",
      "mnemonic": "IQ_COMPANY_NAME_QUICK_MATCH",
      "properties": { "startDate": "2024-01-01", "endRank": "50" }
    },
    {
      "function": "GDSHE",
      "identifier": "COMPANY NAME",
      "mnemonic": "IQ_COMPANY_ID_QUICK_MATCH",
      "properties": { "startDate": "2024-01-01", "endRank": "50" }
    }
  ]
}
```

**Response shape:**
```js
{
  GDSSDKResponse: [
    { Rows: [{ Row: ["Company Name A"] }, { Row: ["Company Name B"] }, ...] },  // [0] names
    { Rows: [{ Row: ["12345"] },          { Row: ["67890"] },          ...] },  // [1] IDs
  ]
}
```

Names and IDs align by index: `names[i]` ↔ `ids[i]`.

#### Enrich request — detail per company ID

After collecting IDs, a second batch call fetches detail fields. All IDs are batched per mnemonic in a single request:

```js
{
  "inputRequests": [
    // n ticker requests (one per ID)
    ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COMPANY_TICKER',  properties: {} })),
    // n website requests
    ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COMPANY_WEBSITE', properties: {} })),
    // n address requests
    ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COMPANY_ADDRESS', properties: {} })),
    // n country requests
    ...ids.map(id => ({ function: 'GDSP', identifier: id, mnemonic: 'IQ_COUNTRY_NAME',    properties: {} })),
  ]
}
```

**Response layout** (`n` = number of IDs):
- `er[0..n-1]` → tickers
- `er[n..2n-1]` → websites
- `er[2n..3n-1]` → addresses
- `er[3n..4n-1]` → countries

Each block: `block.Rows[0].Row[0]` is the value string (or empty/null if not available).

**Ticker format:** May include exchange prefix, e.g. `"NasdaqGS:SBUX"`. Split on `:` to separate exchange and symbol.

---

## Cross-Provider Matching

When results from multiple providers are available, the "All" tab attempts to correlate them.

**Exact match keys** (checked in order):
1. `ticker` — normalized by stripping exchange prefix, uppercased
2. `isin`
3. `lei`

**Squishy match keys** (optional, user-toggled):
4. `website` — strips protocol, `www.`, and path; lowercased
5. `address` — first two components of location, lowercased, non-alphanumeric → spaces

**Algorithm:**
- For each key, build an index per provider: `{ value → arrayIndex }`
- Find values that appear in 2+ providers
- Group into match rows with a `sig` (joined indexes) to deduplicate
- Track which result indexes have been used; remaining counts surface as "X results without a match" note

**Match row shape:**
```js
{
  key:    string,   // 'TICKER' | 'ISIN' | 'LEI' | 'Website' | 'Address'
  val:    string,   // the matched value
  sig:    string,   // e.g. "0:2:-" (moodysIdx:dnbIdx:spIdx, '-' if absent)
  type:   'exact' | 'squishy',
  moodys: Candidate | null,
  dnb:    Candidate | null,
  sp:     Candidate | null,
}
```

---

## Logger

Lives in `logger.js`, shared by popup and log viewer via `web_accessible_resources`.

**Log entry shape:**
```js
{
  id:           string,   // timestamp-based ID e.g. Date.now().toString(36) + random
  timestamp:    string,   // ISO 8601
  action:       string,   // human label e.g. 'D&B Token', 'S&P Search', SOAP action URI
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
Logger.add(entry)                    // prepend to log, trim to 100
Logger.getAll()                      // returns full array
Logger.clear()                       // removes all
Logger.trackedSoapCall(url, action, body)  // wraps a SOAP fetch, logs req+res, returns responseText
Logger._updateEntry(id, updates)     // patches a pending entry with response details
```

`trackedSoapCall` is used for Moody's only (SOAP). D&B and S&P use manual `Logger.add` + `Logger._updateEntry` pattern since their calls aren't SOAP.

**Storage key:** `api_logs` in `chrome.storage.local`, max 100 entries.

---

## UI Patterns

### Search flow

1. User types company name → hits Enter or Search button
2. `doSearch()` reads configured providers from storage
3. All provider calls run in parallel via `Promise.all`
4. Results land in module-level arrays: `moodysCandidates`, `dnbCandidates`, `spCandidates`
5. Each provider renders independently; multi-provider "All" tab renders after all settle

### Provider selector

Pills: **All** | **Moody's** | **D&B** | **S&P** — only shows configured providers.  
If only one provider is configured, selector is hidden and that provider is selected automatically.  
If none configured, search button is disabled and a prompt to open settings is shown.

**Configured provider detection:**
```js
if (s.moodys_username && s.moodys_password) configuredProviders.push('moodys');
if (s.dnb_basic_token)                      configuredProviders.push('dnb');
if (s.sp_username && s.sp_password)         configuredProviders.push('sp');
```

### Results tabs

Built dynamically from the active search's provider list. Tab IDs:
- `panelMatched` — cross-provider matches (only when 2+ providers)
- `panelMoodys`, `panelDnb`, `panelSp` — individual provider results

Each panel has:
- A `<body>` div (e.g. `moodysBody`) for result cards
- A pagination div (e.g. `moodys-pagination`)
- A count badge in the tab (e.g. `moodysCount`)

### Pagination

Client-side. Page size options: 10 / 25 / 50 (default 10).  
Page state: `moodysPage`, `dnbPage`, `spPage` — reset to 1 on new search or page size change.

Pagination renders: Prev | 1 … N-2 N-1 N … Last | Next, with ellipsis gaps. Active page highlighted.

### Result cards

Each provider has its own card CSS class (`result-card` / `dnb-card` / `sp-card`) and ID badge class (`moodys-id` / `dnb-id` / `sp-id`).

Card structure:
```
[ID badge]  [copy hint ⧉]
[Company name]
[Location]
[Meta row: market · ticker · website · isin · lei]  ← only fields with values
```

Clicking anywhere on a card copies the ID to clipboard and shows a toast.

**Ticker display:** Split `"NasdaqGS:SBUX"` → market chip + ticker chip in meta row.

### Settings

Available both as a slide-in panel in popup and as a standalone options page.

Credential fields per provider:

| Provider | Fields |
|----------|--------|
| Moody's | username, password (toggle visible), base URL (optional override) |
| D&B | Basic token (pre-encoded, toggle visible) |
| S&P | username, password (toggle visible) |

Each section has Save + Clear buttons. Status indicators show "✓ Set" / "Not set" per field. Flash messages auto-clear after 2.5s (popup) / 3s (options page).

### Search history

Last 10 searches stored in `search_history`. Shown as a dropdown on input focus/type. Entries can be individually deleted. Selecting a history item fills the input and triggers search.

### Toast notification

Single shared element, shows for 1.8s. Used for copy confirmations.

### Log viewer (`log.html`)

Two-panel layout: list on left, detail on right.  
List refreshes automatically every 3 seconds when the tab is visible.  
Each entry shows: action name, date/time, duration, HTTP status (or error).  
Detail panel shows: action, request body, response body (with XML syntax highlighting), status pill, duration pill.  
Both request and response bodies have copy buttons.  
XML highlighting covers tags, attribute names, attribute values, and comments.

---

## Background Service Worker

**Keep-alive:** A `chrome.alarms` alarm fires every 0.4 minutes as a no-op to keep the service worker from being terminated.

**S&P job polling:** `setInterval(pollForJobs, 1000)` checks `chrome.storage.local` for a pending `SP_JOB` that doesn't yet have a matching `SP_RESULT`. Processes one job at a time (`_processingJob` flag). On completion writes `SP_RESULT` with the `jobId` for correlation.

**S&P token cache in background:** `_spTokenCache` is module-level in background.js (separate instance from popup.js). The background context is the one actually making the S&P network calls.

**`safeDecodeURI`:** Credentials may be URI-encoded before storage; this decodes safely without throwing:
```js
function safeDecodeURI(str) {
  try { return decodeURIComponent(str); } catch (e) { return str; }
}
```

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

`tabs` is used only to open the log page (`chrome.tabs.create`).  
`alarms` is used only for the service worker keep-alive.  
`storage` covers all credential and log persistence.
