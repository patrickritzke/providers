// Background service worker — handles cross-origin API calls and credential tests.

console.log('[Celeste-bg] service worker started v0.3.6');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── Intapp OAuth2 token test (called by credentials popup) ──────────────
  if (msg.type === 'TEST_INTAPP') {
    const { appHost, clientId, clientSecret, redirectUri } = msg.creds;
    const url = `https://${appHost}/auth/oauth/token`;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    })
      .then(res => res.json())
      .then(data => {
        if (!data.access_token) {
          sendResponse({ ok: false, error: data.error_description || data.error || 'No access_token in response' });
          return;
        }
        const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
        chrome.storage.local.set({
          intapp_token: { accessToken: data.access_token, refreshToken: data.refresh_token || null, expiresAt },
        });
        sendResponse({ ok: true, detail: `Token received — expires in ${Math.round((data.expires_in || 3600) / 60)} min` });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ── D&B bearer token test ────────────────────────────────────────────────
  if (msg.type === 'TEST_DNB') {
    fetch('https://plus.dnb.com/v2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${msg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials' }),
    })
      .then(res => res.json())
      .then(data => {
        if (!data.access_token) {
          sendResponse({ ok: false, error: 'No access_token in response' });
          return;
        }
        sendResponse({ ok: true, detail: 'D&B token received' });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ── Corporate family tree fetch (called by content script) ───────────────
  if (msg.type === 'FETCH_CORPORATE_FAMILY') {
    const { partyId, token, appHost } = msg;
    console.log('[Celeste-bg] fetching party', partyId, 'from', appHost);
    const url = `https://${appHost}/api/party/v1/parties/${encodeURIComponent(partyId)}?properties=CorporateFamily`;
    fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
      .then(res => res.json().then(data => ({ ok: res.ok, status: res.status, data })))
      .then(({ ok, status, data }) => {
        if (!ok) sendResponse({ ok: false, error: `Intapp API ${status}` });
        else sendResponse({ ok: true, data });
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});
