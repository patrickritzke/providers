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
    const { partyId, appHost } = msg;
    console.log('[Celeste-bg] fetching party', partyId, 'from', appHost);

    async function doFetch() {
      // Always use the freshest token from storage
      const stored = await new Promise(r => chrome.storage.local.get(['intapp_token', 'intapp_credentials'], r));
      const token   = stored.intapp_token?.accessToken || stored.intapp_token?.token;
      const creds   = stored.intapp_credentials;

      if (!token)   throw new Error('No Intapp token — open the Celeste extension popup and Save & Test Intapp credentials.');
      if (!appHost) throw new Error('No Intapp app host configured.');

      // Check expiry and refresh if needed
      const expiresAt = stored.intapp_token?.expiresAt || 0;
      let activeToken = token;
      if (expiresAt && Date.now() > expiresAt - 60_000 && creds?.clientId && creds?.clientSecret) {
        console.log('[Celeste-bg] token expired, refreshing…');
        try {
          const tRes = await fetch(`https://${appHost}/auth/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=client_credentials&client_id=${encodeURIComponent(creds.clientId)}&client_secret=${encodeURIComponent(creds.clientSecret)}&redirect_uri=${encodeURIComponent(creds.redirectUri || '')}`,
          });
          const tData = await tRes.json();
          if (tData.access_token) {
            activeToken = tData.access_token;
            const newExpiry = Date.now() + (tData.expires_in || 3600) * 1000;
            chrome.storage.local.set({ intapp_token: { accessToken: activeToken, expiresAt: newExpiry } });
            console.log('[Celeste-bg] token refreshed');
          }
        } catch (e) {
          console.warn('[Celeste-bg] token refresh failed', e.message);
        }
      }

      const url = `https://${appHost}/api/party/v1/parties/${encodeURIComponent(partyId)}?properties=CorporateFamily`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${activeToken}`, Accept: 'application/json' },
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const body = await res.text();
        throw new Error(`Intapp API ${res.status} — response was not JSON (got ${contentType || 'unknown'}). Token may be expired — re-save credentials in the Celeste popup. Body preview: ${body.slice(0, 120)}`);
      }

      const data = await res.json();
      if (!res.ok) throw new Error(`Intapp API ${res.status}: ${data.message || data.error || JSON.stringify(data).slice(0, 100)}`);
      return data;
    }

    doFetch()
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});
