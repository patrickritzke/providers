// Background service worker — makes cross-origin API calls on behalf of
// content scripts, which are subject to CORS but service workers are not.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'FETCH_CORPORATE_FAMILY') return false;

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

  return true; // keep message channel open for async response
});
