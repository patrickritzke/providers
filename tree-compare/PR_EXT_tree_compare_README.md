# credentials component

Two files. Drop into any extension. Never edit them — just use them.

## Files
- `PR_EXT_tree_compare.js` — all logic, UI, storage. Self-contained.
- `PR_EXT_tree_compare.html` — standalone page (use as popup or options page)

---

## Drop into an existing popup

Add the mount anchor wherever you want the credentials section to appear:

```html
<!-- inside your existing popup.html settings section -->
<div id="credentials-root"></div>
<script src="PR_EXT_tree_compare.js"></script>
```

That's it. The component auto-mounts on DOMContentLoaded.

---

## Use as a dedicated options/credentials page

Add to `manifest.json`:

```json
"options_page": "PR_EXT_tree_compare.html"
```

Or open it from a button in your popup:

```javascript
document.getElementById('open-creds').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
```

---

## Read credentials anywhere (background.js, content.js, popup.js)

```javascript
// Read one
const { dnb_basic_token } = await CredentialsManager.get(['dnb_basic_token']);

// Read several
const { moodys_username, moodys_password, moodys_base_url } =
  await CredentialsManager.get(['moodys_username', 'moodys_password', 'moodys_base_url']);

// Read Intapp (object)
const { intapp_credentials } = await CredentialsManager.get(['intapp_credentials']);
const { appHost, clientId, clientSecret } = intapp_credentials || {};
```

Or just use `chrome.storage.local.get` directly — the keys are the same.

---

## Storage keys

| Key | Type | Description |
|-----|------|-------------|
| `intapp_credentials` | `{ appHost, clientId, clientSecret }` | Intapp OAuth2 |
| `intapp_token` | `{ token, expiresAt }` | Cached bearer (managed by background.js, not this UI) |
| `dnb_basic_token` | string | `btoa('key:secret')` from D&B Direct+ portal |
| `geoapify_api_key` | string | From geoapify.com |
| `moodys_username` | string | Moody's / BvD login |
| `moodys_password` | string | Moody's / BvD password |
| `moodys_base_url` | string | e.g. `https://your-instance.bvdinfo.com` |
| `sp_username` | string | S&P Capital IQ / Market Intelligence login |
| `sp_password` | string | S&P Capital IQ password |
| `spx_username` | string | S&P Xpressapi login |
| `spx_password` | string | S&P Xpressapi password |
| `spx_token` | `{ access_token, refresh_token, expiresAt }` | Cached Xpressapi bearer (set by "Test & Save") |

## Using S&P Xpressapi token in background.js

```javascript
// Get a valid token (throws 'NO_SPX_TOKEN' or 'SPX_TOKEN_EXPIRED' if not ready)
try {
  const token = await CredentialsManager.getSpxToken();
  // use token in Authorization: Bearer header
} catch (err) {
  if (err.message === 'SPX_TOKEN_EXPIRED') {
    // prompt user to re-authenticate via the credentials page
  }
}

// Or read it directly and handle expiry yourself:
const { spx_token } = await CredentialsManager.get(['spx_token']);
if (spx_token && Date.now() < spx_token.expiresAt) {
  // spx_token.access_token is valid
}
```

---

## Adding a new credential

In `PR_EXT_tree_compare.js`, find the relevant section template and add a field. Then add to:
1. `loadFields()` — to populate it on load
2. the save/clear handler — to persist and clear it
3. `refreshDots()` — if you want a status dot for the new service
