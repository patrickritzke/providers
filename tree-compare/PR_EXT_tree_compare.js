// ─── credentials.js ──────────────────────────────────────────────────────────
// Drop-in tree compare for Chrome extensions.
// Version: 1.1.4
//
// CHANGELOG:
//   1.1.4 — BvD base URL field removed; hardcoded webservices.bvdinfo.com
//   1.1.2 — BvD uses SOAP Open call; status dots replaced with Test All button
//   1.1.1 — Worker: xpx/token matches Postman exactly (query params + x-www-form-urlencoded + Basic)
//   1.1.0 — Removed BvD Base URL field; hardcoded api.bvdinfo.com
//   1.0.9 — saveAndTest: save always completes before test; save errors shown separately
//   1.0.8 — Hardcoded Cloudflare worker URL for both S&P sections; removed proxy field
//   1.0.7 — Intapp: added Tenant ID + Redirect URI fields; token URL matches party-extension
//   1.0.6 — All buttons now Save & Test; S&P + Xpressapi route through shared proxy
//   1.0.5 — Combined CapIQ + Xpressapi into single PR_EXT_tree_compare_worker.js (/xpx/* routes)
//   1.0.4 — Copy All / Paste All buttons (clipboard import/export)
//   1.0.3 — Save & Test on all providers; D&B tests bearer token exchange
//   1.0.2 — S&P Xpressapi section + proxy worker
//   1.0.1 — S&P Xpressapi added to storage keys
//   1.0.0 — Initial: Intapp, D&B, Geoapify, Moody's, S&P Global

const SP_PROXY = 'https://delicate-union-802c.patrickritzke.workers.dev';
//
// USAGE:
//   1. Add <div id="credentials-root"></div> wherever you want it in your popup HTML
//   2. <script src="credentials.js"></script> at the bottom of that HTML
//   3. Read any credential at any time:
//        const { dnb_basic_token } = await CredentialsManager.get(['dnb_basic_token']);
//
// STORAGE KEYS (all chrome.storage.local):
//   intapp_credentials  → { appHost, clientId, clientSecret }
//   intapp_token        → cached bearer { token, expiresAt } (managed by background.js, not this UI)
//   dnb_basic_token     → string  (btoa('key:secret'))
//   geoapify_api_key    → string
//   moodys_username     → string
//   moodys_password     → string
//   sp_username         → string  (S&P Capital IQ / Market Intelligence)
//   sp_password         → string
//   spx_username        → string  (S&P Xpressapi)
//   spx_password        → string
//   spx_token           → { access_token, refresh_token, expiresAt }
// ─────────────────────────────────────────────────────────────────────────────

const CredentialsManager = (() => {

  // ── Public API ──────────────────────────────────────────────────────────────
  async function get(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }

  async function set(obj) {
    return new Promise(resolve => chrome.storage.local.set(obj, resolve));
  }

  async function remove(keys) {
    return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function eyeIcon(id) {
    return `<button class="creds-eye" data-target="${id}" title="Show/hide" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    </button>`;
  }

  function secretField(id, placeholder, hint = '') {
    return `
      <div class="creds-secret-wrap">
        <input class="creds-input" id="${id}" type="password"
               placeholder="${placeholder}" autocomplete="off" spellcheck="false"/>
        ${eyeIcon(id)}
      </div>
      ${hint ? `<div class="creds-hint">${hint}</div>` : ''}`;
  }

  function textField(id, placeholder, hint = '') {
    return `
      <input class="creds-input" id="${id}" type="text"
             placeholder="${placeholder}" autocomplete="off" spellcheck="false"/>
      ${hint ? `<div class="creds-hint">${hint}</div>` : ''}`;
  }

  function section(title, color, body) {
    return `
      <div class="creds-section">
        <div class="creds-section-title" style="color:${color}">${title}</div>
        ${body}
      </div>`;
  }

  function statusDot(id) { return ''; } // dots removed — Test All button used instead

  // ── HTML template ────────────────────────────────────────────────────────────
  const TEMPLATE = `
    <style>
      .creds-root * { box-sizing: border-box; margin: 0; padding: 0; }
      .creds-root {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 12px; color: #1e293b;
      }

      /* Test All button */
      .creds-testall-bar {
        display: flex; gap: 7px; margin-bottom: 12px; align-items: center;
      }
      .creds-testall-btn {
        flex: 1; padding: 7px 10px; border-radius: 7px;
        font-size: 11px; font-weight: 600; font-family: inherit;
        cursor: pointer; transition: all 0.15s;
        background: #f0fdf4; color: #166534;
        border: 1.5px solid #bbf7d0;
        display: flex; align-items: center; justify-content: center; gap: 5px;
      }
      .creds-testall-btn:hover { background: #dcfce7; }
      .creds-testall-result {
        display: none; margin-bottom: 10px; padding: 7px 10px;
        border-radius: 6px; font-size: 11px; line-height: 1.6;
        background: #f8fafc; border: 1px solid #e2e8f0; color: #475569;
      }
      .creds-testall-result.show { display: block; }

      /* Sections */
      .creds-section {
        padding: 14px 0;
        border-top: 1px solid #f1f5f9;
      }
      .creds-section:first-of-type { border-top: none; padding-top: 0; }
      .creds-section-title {
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.6px; margin-bottom: 10px;
      }

      /* Fields */
      .creds-field { margin-bottom: 9px; }
      .creds-label {
        display: block; font-size: 10px; font-weight: 600;
        color: #475569; text-transform: uppercase;
        letter-spacing: 0.4px; margin-bottom: 3px;
      }
      .creds-input {
        width: 100%; padding: 7px 10px;
        border: 1.5px solid #e2e8f0; border-radius: 6px;
        font-size: 12px; font-family: inherit;
        color: #1e293b; background: #f8fafc;
        outline: none; transition: all 0.15s;
      }
      .creds-input:focus { border-color: #6366f1; background: #fff; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
      .creds-hint { font-size: 10px; color: #94a3b8; margin-top: 2px; }
      .creds-secret-wrap { position: relative; }
      .creds-secret-wrap .creds-input { padding-right: 32px; }
      .creds-eye {
        position: absolute; right: 7px; top: 50%; transform: translateY(-50%);
        background: none; border: none; cursor: pointer;
        color: #94a3b8; padding: 2px;
      }
      .creds-eye:hover { color: #6366f1; }
      .creds-eye svg { width: 14px; height: 14px; display: block; }

      /* Buttons */
      .creds-btn-row { display: flex; gap: 7px; margin-top: 8px; }
      .creds-btn {
        flex: 1; padding: 7px; border-radius: 7px;
        font-size: 12px; font-weight: 600; font-family: inherit;
        cursor: pointer; border: none; transition: all 0.15s;
      }
      .creds-btn-ghost { background: transparent; color: #ef4444; border: 1.5px solid #fecaca; }
      .creds-btn-ghost:hover { background: #fef2f2; }
      .creds-btn-primary {
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: white; box-shadow: 0 2px 5px rgba(99,102,241,0.3);
      }
      .creds-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(99,102,241,0.4); }

      /* Toast */
      .creds-toast {
        display: none; margin-top: 7px; padding: 7px 10px;
        border-radius: 6px; font-size: 11px; font-weight: 500;
      }
      .creds-toast.show  { display: block; }
      .creds-toast.ok    { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
      .creds-toast.err   { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
      .creds-toast.info  { background: #eef2ff; color: #3730a3; border: 1px solid #c7d2fe; }

      /* Copy/Paste bar */
      .creds-cpbar {
        display: flex; gap: 7px; margin-bottom: 12px;
      }
      .creds-cpbtn {
        flex: 1; padding: 7px 10px; border-radius: 7px;
        font-size: 11px; font-weight: 600; font-family: inherit;
        cursor: pointer; transition: all 0.15s; display: flex;
        align-items: center; justify-content: center; gap: 5px;
      }
      .creds-cpbtn-copy {
        background: #f8fafc; color: #475569;
        border: 1.5px solid #e2e8f0;
      }
      .creds-cpbtn-copy:hover { background: #e2e8f0; }
      .creds-cpbtn-paste {
        background: #f0fdf4; color: #166534;
        border: 1.5px solid #bbf7d0;
      }
      .creds-cpbtn-paste:hover { background: #dcfce7; }
      .creds-cp-toast {
        display: none; margin-bottom: 10px; padding: 6px 10px;
        border-radius: 6px; font-size: 11px; font-weight: 500; text-align: center;
      }
      .creds-cp-toast.show { display: block; }
      .creds-cp-toast.ok   { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
      .creds-cp-toast.err  { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
      .creds-cp-toast.info { background: #eef2ff; color: #3730a3; border: 1px solid #c7d2fe; }
    </style>

    <div class="creds-root">

      <!-- Copy All / Paste All -->
      <div class="creds-cpbar">
        <button class="creds-cpbtn creds-cpbtn-copy" id="creds-copy-all">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy All
        </button>
        <button class="creds-cpbtn creds-cpbtn-paste" id="creds-paste-all">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>
          Paste All
        </button>
      </div>
      <div class="creds-cp-toast" id="creds-cp-toast"></div>

      <!-- Test All -->
      <div class="creds-testall-bar">
        <button class="creds-testall-btn" id="creds-test-all">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Test All
        </button>
      </div>
      <div class="creds-testall-result" id="creds-testall-result"></div>

      <!-- ── Intapp ─────────────────────────────────────────────────── -->
      ${section('Intapp OAuth2', '#6366f1', `
        <div class="creds-field">
          <label class="creds-label" for="creds-intapp-host">App Host</label>
          ${textField('creds-intapp-host', 'e.g. shalaka2-sand.opensandbox2.intapp.com', 'Subdomain only — no https://')}
        </div>
        <div class="creds-field">
          <label class="creds-label" for="creds-intapp-tenant">Tenant ID</label>
          ${textField('creds-intapp-tenant', 'e.g. bfd4dce72', 'Numeric ID from your tenant directory')}
        </div>
        <div class="creds-field">
          <label class="creds-label" for="creds-intapp-client-id">Client ID</label>
          ${textField('creds-intapp-client-id', 'e.g. MN0OD224O8')}
        </div>
        <div class="creds-field">
          <label class="creds-label" for="creds-intapp-secret">Client Secret</label>
          ${secretField('creds-intapp-secret', 'Your client secret')}
        </div>
        <div class="creds-field">
          <label class="creds-label" for="creds-intapp-redirect">Redirect URI</label>
          ${textField('creds-intapp-redirect', 'e.g. https://...intapp.com/api/oauth2/callback')}
        </div>
        <div class="creds-btn-row">
          <button class="creds-btn creds-btn-ghost" id="creds-intapp-clear">Clear</button>
          <button class="creds-btn creds-btn-primary" id="creds-intapp-save">Save &amp; Test</button>
        </div>
        <div class="creds-toast" id="toast-intapp"></div>
      `)}

      <!-- ── D&B Direct+ ────────────────────────────────────────────── -->
      ${section('D&amp;B Direct+', '#f59e0b', `
        <div class="creds-field">
          <label class="creds-label" for="creds-dnb-token">Basic Token</label>
          ${secretField('creds-dnb-token', 'Base64 encoded key:secret', 'btoa("key:secret") from the D&B Direct+ portal')}
        </div>
        <div class="creds-btn-row">
          <button class="creds-btn creds-btn-ghost" id="creds-dnb-clear">Clear</button>
          <button class="creds-btn creds-btn-primary" id="creds-dnb-save">Save &amp; Test</button>
        </div>
        <div class="creds-toast" id="toast-dnb"></div>
      `)}

      <!-- ── Geoapify ───────────────────────────────────────────────── -->
      ${section('Geoapify', '#0e9e9e', `
        <div class="creds-field">
          <label class="creds-label" for="creds-geoapify-key">API Key</label>
          ${secretField('creds-geoapify-key', 'Geoapify API key', 'geoapify.com — free tier: 3,000 req/day')}
        </div>
        <div class="creds-btn-row">
          <button class="creds-btn creds-btn-ghost" id="creds-geoapify-clear">Clear</button>
          <button class="creds-btn creds-btn-primary" id="creds-geoapify-save">Save &amp; Test</button>
        </div>
        <div class="creds-toast" id="toast-geoapify"></div>
      `)}

      <!-- ── Moody's / BvD ─────────────────────────────────────────── -->
      ${section("Moody's / Bureau van Dijk", '#ef4444', `
        <div class="creds-field">
          <label class="creds-label" for="creds-moodys-user">Username</label>
          ${textField('creds-moodys-user', 'Moody\'s username')}
        </div>
        <div class="creds-field">
          <label class="creds-label" for="creds-moodys-pass">Password</label>
          ${secretField('creds-moodys-pass', 'Moody\'s password')}
        </div>
        <div class="creds-btn-row">
          <button class="creds-btn creds-btn-ghost" id="creds-moodys-clear">Clear</button>
          <button class="creds-btn creds-btn-primary" id="creds-moodys-save">Save &amp; Test</button>
        </div>
        <div class="creds-toast" id="toast-moodys"></div>
      `)}

      <!-- ── S&P Global ─────────────────────────────────────────────── -->
      ${section('S&amp;P Global', '#3b82f6', `
        <div class="creds-field">
          <label class="creds-label" for="creds-sp-user">Username</label>
          ${textField('creds-sp-user', 'S&P username')}
        </div>
        <div class="creds-field">
          <label class="creds-label" for="creds-sp-pass">Password</label>
          ${secretField('creds-sp-pass', 'S&P password')}
        </div>
        <div class="creds-btn-row">
          <button class="creds-btn creds-btn-ghost" id="creds-sp-clear">Clear</button>
          <button class="creds-btn creds-btn-primary" id="creds-sp-save">Save &amp; Test</button>
        </div>
        <div class="creds-toast" id="toast-sp"></div>
      `)}

      <!-- ── S&P Xpressapi ──────────────────────────────────────────── -->
      ${section('S&amp;P Xpressapi', '#0284c7', `
        <div class="creds-field">
          <label class="creds-label" for="creds-spx-user">Username</label>
          ${textField('creds-spx-user', 'Xpressapi username')}
        </div>
        <div class="creds-field">
          <label class="creds-label" for="creds-spx-pass">Password</label>
          ${secretField('creds-spx-pass', 'Xpressapi password')}
        </div>
        <div class="creds-btn-row">
          <button class="creds-btn creds-btn-ghost" id="creds-spx-clear">Clear</button>
          <button class="creds-btn creds-btn-primary" id="creds-spx-test">Save &amp; Test</button>
        </div>
        <div class="creds-toast" id="toast-spx"></div>
        <div class="creds-spx-token-info" id="spx-token-info" style="display:none;margin-top:8px;padding:7px 9px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;font-size:10px;color:#0369a1;line-height:1.6;"></div>
      `)}

      <div style="margin-top:14px;padding-top:10px;border-top:1px solid #f1f5f9;text-align:center;font-size:10px;color:#cbd5e1;">
        PR_EXT_tree_compare.js · v1.0.7
      </div>

    </div>`;

  // ── Toast helper ────────────────────────────────────────────────────────────
  function toast(id, msg, type = 'ok', ms = 2200) {
    const el = document.getElementById(`toast-${id}`);
    if (!el) return;
    el.textContent = msg;
    el.className = `creds-toast show ${type}`;
    setTimeout(() => { el.className = 'creds-toast'; }, ms);
  }

  // ── Status dots ─────────────────────────────────────────────────────────────
  async function refreshDots() {} // dots removed

  // ── Load saved values into fields ────────────────────────────────────────────
  async function loadFields() {
    const s = await get([
      'intapp_credentials', 'dnb_basic_token', 'geoapify_api_key',
      'moodys_username', 'moodys_password',
      'sp_username', 'sp_password',
      'spx_username', 'spx_password', 'spx_token'
    ]);

    const v = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };

    const ic = s.intapp_credentials || {};
    v('creds-intapp-host',      ic.appHost);
    v('creds-intapp-tenant',    ic.tenantId);
    v('creds-intapp-client-id', ic.clientId);
    v('creds-intapp-secret',    ic.clientSecret);
    v('creds-intapp-redirect',  ic.redirectUri);
    v('creds-dnb-token',        s.dnb_basic_token);
    v('creds-geoapify-key',     s.geoapify_api_key);
    v('creds-moodys-user',      s.moodys_username);
    v('creds-moodys-pass',      s.moodys_password);
    v('creds-sp-user',          s.sp_username);
    v('creds-sp-pass',          s.sp_password);
    v('creds-spx-user',         s.spx_username);
    v('creds-spx-pass',         s.spx_password);

    // Show cached token info if present
    if (s.spx_token?.access_token) showSpxTokenInfo(s.spx_token);
  }

  // ── Wire all buttons ─────────────────────────────────────────────────────────
  function wireButtons() {

    // Eye toggles
    document.querySelectorAll('.creds-eye').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (input) input.type = input.type === 'password' ? 'text' : 'password';
      });
    });

    // ── Shared test helper — ALWAYS saves first, test failure never blocks save
    async function saveAndTest(id, saveFn, testFn) {
      const btn = document.getElementById(`creds-${id}-save`);
      btn.textContent = 'Saving…'; btn.disabled = true;
      try {
        await saveFn();
        refreshDots();
      } catch (saveErr) {
        toast(id, `Save failed: ${saveErr.message}`, 'err', 6000);
        btn.textContent = 'Save & Test'; btn.disabled = false;
        return; // don't attempt test if save itself failed
      }
      btn.textContent = 'Testing…';
      try {
        const result = await testFn();
        toast(id, `✓ Saved & connected${result ? ' — ' + result : ''}`, 'ok', 4000);
      } catch (testErr) {
        toast(id, `✓ Saved — test failed: ${testErr.message}`, 'err', 6000);
      } finally {
        btn.textContent = 'Save & Test'; btn.disabled = false;
      }
    }

    // ── Intapp — OAuth2 token request
    document.getElementById('creds-intapp-save').addEventListener('click', async () => {
      const appHost      = document.getElementById('creds-intapp-host').value.trim().replace(/^https?:\/\//, '');
      const tenantId     = document.getElementById('creds-intapp-tenant').value.trim();
      const clientId     = document.getElementById('creds-intapp-client-id').value.trim();
      const clientSecret = document.getElementById('creds-intapp-secret').value.trim();
      const redirectUri  = document.getElementById('creds-intapp-redirect').value.trim();
      if (!appHost)      { toast('intapp', 'App Host is required', 'err'); return; }
      if (!tenantId)     { toast('intapp', 'Tenant ID is required', 'err'); return; }
      if (!clientId)     { toast('intapp', 'Client ID is required', 'err'); return; }
      if (!clientSecret) { toast('intapp', 'Client Secret is required', 'err'); return; }
      if (!redirectUri)  { toast('intapp', 'Redirect URI is required', 'err'); return; }
      await saveAndTest('intapp',
        () => set({ intapp_credentials: { appHost, tenantId, clientId, clientSecret, redirectUri } }),
        async () => {
          const res = await chrome.runtime.sendMessage({ type: 'TEST_INTAPP', creds: { appHost, clientId, clientSecret, redirectUri } });
          if (!res.ok) throw new Error(res.error);
          return res.detail;
        }
      );
    });
    document.getElementById('creds-intapp-clear').addEventListener('click', async () => {
      if (!confirm('Clear Intapp credentials?')) return;
      await remove(['intapp_credentials', 'intapp_token']);
      ['creds-intapp-host','creds-intapp-tenant','creds-intapp-client-id','creds-intapp-secret','creds-intapp-redirect'].forEach(id => { document.getElementById(id).value = ''; });
      toast('intapp', 'Cleared', 'info'); refreshDots();
    });

    // ── D&B — exchange basic token for bearer token
    document.getElementById('creds-dnb-save').addEventListener('click', async () => {
      const token = document.getElementById('creds-dnb-token').value.trim();
      if (!token) { toast('dnb', 'Token required', 'err'); return; }
      await saveAndTest('dnb',
        () => set({ dnb_basic_token: token }),
        async () => {
          const res = await chrome.runtime.sendMessage({ type: 'TEST_DNB', token });
          if (!res.ok) throw new Error(res.error);
          return res.detail;
        }
      );
    });
    document.getElementById('creds-dnb-clear').addEventListener('click', async () => {
      if (!confirm('Clear D&B token?')) return;
      await remove('dnb_basic_token');
      document.getElementById('creds-dnb-token').value = '';
      toast('dnb', 'Cleared', 'info'); refreshDots();
    });

    // ── Geoapify — geocode a known address
    document.getElementById('creds-geoapify-save').addEventListener('click', async () => {
      const key = document.getElementById('creds-geoapify-key').value.trim();
      if (!key) { toast('geoapify', 'Key required', 'err'); return; }
      await saveAndTest('geoapify',
        () => set({ geoapify_api_key: key }),
        async () => {
          const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent('1600 Pennsylvania Ave, Washington DC')}&apiKey=${encodeURIComponent(key)}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const formatted = data?.features?.[0]?.properties?.formatted;
          if (!formatted) throw new Error('No results returned');
          return formatted;
        }
      );
    });
    document.getElementById('creds-geoapify-clear').addEventListener('click', async () => {
      if (!confirm('Clear Geoapify key?')) return;
      await remove('geoapify_api_key');
      document.getElementById('creds-geoapify-key').value = '';
      toast('geoapify', 'Cleared', 'info'); refreshDots();
    });

    // ── Moody's / BvD — SOAP Open call
    document.getElementById('creds-moodys-save').addEventListener('click', async () => {
      const username = document.getElementById('creds-moodys-user').value.trim();
      const password = document.getElementById('creds-moodys-pass').value.trim();
      const baseUrl  = 'https://webservices.bvdinfo.com/v1.3/orbis4/remoteaccess.asmx';
      if (!username || !password) { toast('moodys', 'Username and password required', 'err'); return; }
      await saveAndTest('moodys',
        () => set({ moodys_username: username, moodys_password: password }),
        async () => {
          const soapBody = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://bvdep.com/webservices/">
   <soapenv:Header/>
   <soapenv:Body>
      <web:Open>
         <web:username>${username}</web:username>
         <web:password>${password}</web:password>
      </web:Open>
   </soapenv:Body>
</soapenv:Envelope>`;
          const res = await fetch(baseUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/xml; charset=utf-8',
              'SOAPAction': 'http://bvdep.com/webservices/Open'
            },
            body: soapBody
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          const match = text.match(/<OpenResult>(.*?)<\/OpenResult>/);
          if (!match) throw new Error('No session ID in response');
          return `session ID received`;
        }
      );
    });
    document.getElementById('creds-moodys-clear').addEventListener('click', async () => {
      if (!confirm("Clear Moody's credentials?")) return;
      await remove(['moodys_username', 'moodys_password']);
      ['creds-moodys-user','creds-moodys-pass'].forEach(id => { document.getElementById(id).value = ''; });
      toast('moodys', 'Cleared', 'info'); refreshDots();
    });

    // ── S&P Capital IQ — auth token request
    document.getElementById('creds-sp-save').addEventListener('click', async () => {
      const username = document.getElementById('creds-sp-user').value.trim();
      const password = document.getElementById('creds-sp-pass').value.trim();
      const proxyUrl = SP_PROXY; // shared proxy
      if (!username || !password) { toast('sp', 'Username and password required', 'err'); return; }
      await saveAndTest('sp',
        () => set({ sp_username: username, sp_password: password }),
        async () => {
          const basicCred = btoa(`${username}:${password}`);
          const body = new URLSearchParams({ username, password });
          const tokenUrl = proxyUrl
            ? `${proxyUrl.replace(/\/$/, '')}/token`
            : 'https://api-ciq.marketintelligence.spglobal.com/gdsapi/rest/authenticate/api/v1/token';
          const res = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Authorization': `Basic ${basicCred}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': '*/*' },
            body: body.toString()
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (!data.access_token) throw new Error('No access_token in response');
          return 'token received';
        }
      );
    });
    document.getElementById('creds-sp-clear').addEventListener('click', async () => {
      if (!confirm('Clear S&P credentials?')) return;
      await remove(['sp_username', 'sp_password']);
      ['creds-sp-user','creds-sp-pass'].forEach(id => { document.getElementById(id).value = ''; });
      toast('sp', 'Cleared', 'info'); refreshDots();
    });

    // ── S&P Xpressapi — save first always, test via proxy /xpx/token
    document.getElementById('creds-spx-test').addEventListener('click', async () => {
      const username = document.getElementById('creds-spx-user').value.trim();
      const password = document.getElementById('creds-spx-pass').value.trim();
      const proxyUrl = SP_PROXY;
      if (!username || !password) { toast('spx', 'Username and password required', 'err'); return; }

      const btn = document.getElementById('creds-spx-test');
      btn.textContent = 'Testing…'; btn.disabled = true;

      await set({ spx_username: username, spx_password: password });
      refreshDots();

      try {
        const tokenUrl = proxyUrl
          ? `${proxyUrl.replace(/\/$/, '')}/xpx/token`
          : `https://xpressapi.marketplace.spglobal.com/authenticate/api/v1/token?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
        const fetchOpts = proxyUrl
          ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }
          : { method: 'POST', headers: { 'Content-Type': 'application/json' } };

        const res = await fetch(tokenUrl, fetchOpts);
        const data = await res.json();
        if (!res.ok || !data.access_token) throw new Error(data.message || data.error || `HTTP ${res.status}`);

        const expiresAt = Date.now() + (parseInt(data.expires_in_seconds, 10) || 3600) * 1000;
        const tokenObj = { access_token: data.access_token, refresh_token: data.refresh_token || null, expiresAt };
        await set({ spx_token: tokenObj });
        showSpxTokenInfo(tokenObj);
        toast('spx', '✓ Saved & connected — bearer token received', 'ok', 4000);
      } catch (err) {
        toast('spx', `✓ Saved — test failed: ${err.message}`, 'err', 6000);
      } finally {
        btn.textContent = 'Save & Test'; btn.disabled = false;
      }
    });
    document.getElementById('creds-spx-clear').addEventListener('click', async () => {
      if (!confirm('Clear S&P Xpressapi credentials?')) return;
      await remove(['spx_username', 'spx_password', 'spx_token']);
      ['creds-spx-user','creds-spx-pass'].forEach(id => { document.getElementById(id).value = ''; });
      const info = document.getElementById('spx-token-info');
      if (info) { info.style.display = 'none'; info.textContent = ''; }
      toast('spx', 'Cleared', 'info'); refreshDots();
    });

    // ── Test All ─────────────────────────────────────────────────────────────
    document.getElementById('creds-test-all').addEventListener('click', async () => {
      const btn = document.getElementById('creds-test-all');
      const out = document.getElementById('creds-testall-result');
      btn.textContent = 'Testing…'; btn.disabled = true;
      out.className = 'creds-testall-result show';
      out.textContent = 'Running tests…';

      const s = await get([
        'intapp_credentials', 'dnb_basic_token', 'geoapify_api_key',
        'moodys_username', 'moodys_password', 'moodys_base_url',
        'sp_username', 'sp_password', 'spx_username', 'spx_password'
      ]);

      const results = [];

      const run = async (label, fn) => {
        try { const msg = await fn(); results.push(`✅ ${label}: ${msg}`); }
        catch (e) { results.push(`❌ ${label}: ${e.message}`); }
      };

      // Intapp
      const ic = s.intapp_credentials || {};
      if (ic.appHost && ic.clientId && ic.clientSecret) {
        await run('Intapp', async () => {
          const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: ic.clientId, client_secret: ic.clientSecret, redirect_uri: ic.redirectUri || '' });
          const res = await fetch(`https://${ic.appHost}/auth/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const d = await res.json();
          if (!d.access_token) throw new Error('No token');
          return 'token received';
        });
      } else results.push('⬜ Intapp: not configured');

      // D&B
      if (s.dnb_basic_token) {
        await run('D&B', async () => {
          const res = await fetch('https://plus.dnb.com/v2/token', { method: 'POST', headers: { 'Authorization': `Basic ${s.dnb_basic_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials' }) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const d = await res.json();
          if (!d.access_token) throw new Error('No token');
          return 'token received';
        });
      } else results.push('⬜ D&B: not configured');

      // Geoapify
      if (s.geoapify_api_key) {
        await run('Geoapify', async () => {
          const res = await fetch(`https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent('1600 Pennsylvania Ave, Washington DC')}&apiKey=${encodeURIComponent(s.geoapify_api_key)}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const d = await res.json();
          if (!d?.features?.[0]) throw new Error('No results');
          return d.features[0].properties.formatted;
        });
      } else results.push('⬜ Geoapify: not configured');

      // Moody's / BvD — SOAP
      if (s.moodys_username && s.moodys_password) {
        await run("Moody's / BvD", async () => {
          const url = s.moodys_base_url || 'https://webservices.bvdinfo.com/v1.3/orbis4/remoteaccess.asmx';
          const soap = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://bvdep.com/webservices/"><soapenv:Header/><soapenv:Body><web:Open><web:username>${s.moodys_username}</web:username><web:password>${s.moodys_password}</web:password></web:Open></soapenv:Body></soapenv:Envelope>`;
          const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'http://bvdep.com/webservices/Open' }, body: soap });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          const match = text.match(/<OpenResult>(.*?)<\/OpenResult>/);
          if (!match) throw new Error('No session ID in response');
          return 'session ID received';
        });
      } else results.push('⬜ Moody\'s / BvD: not configured');

      // S&P Capital IQ
      if (s.sp_username && s.sp_password) {
        await run('S&P Capital IQ', async () => {
          const basicCred = btoa(`${s.sp_username}:${s.sp_password}`);
          const body = new URLSearchParams({ username: s.sp_username, password: s.sp_password });
          const res = await fetch(`${SP_PROXY}/token`, { method: 'POST', headers: { 'Authorization': `Basic ${basicCred}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': '*/*' }, body: body.toString() });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const d = await res.json();
          if (!d.access_token) throw new Error('No token');
          return 'token received';
        });
      } else results.push('⬜ S&P Capital IQ: not configured');

      // Xpressapi
      if (s.spx_username && s.spx_password) {
        await run('S&P Xpressapi', async () => {
          const res = await fetch(`${SP_PROXY}/xpx/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: s.spx_username, password: s.spx_password }) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const d = await res.json();
          if (!d.access_token) throw new Error('No token');
          return 'token received';
        });
      } else results.push('⬜ S&P Xpressapi: not configured');

      out.innerHTML = results.join('<br>');
      btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Test All';
      btn.disabled = false;
    });

    // ── Copy All / Paste All ─────────────────────────────────────────────────
    // Format: key:value|key:value  (values may contain colons, split on first : only)
    const CP_KEYS = [
      'intapp-host', 'intapp-tenant', 'intapp-client-id', 'intapp-secret', 'intapp-redirect',
      'dnb-token',
      'geoapify-key',
      'moodys-user', 'moodys-pass',
      'sp-user', 'sp-pass',
      'spx-user', 'spx-pass',
    ];

    function cpToast(msg, type = 'ok', ms = 2500) {
      const el = document.getElementById('creds-cp-toast');
      el.textContent = msg; el.className = `creds-cp-toast show ${type}`;
      setTimeout(() => { el.className = 'creds-cp-toast'; }, ms);
    }

    document.getElementById('creds-copy-all').addEventListener('click', async () => {
      const pairs = CP_KEYS
        .map(k => {
          const el = document.getElementById(`creds-${k}`);
          return el?.value?.trim() ? `${k}:${el.value.trim()}` : null;
        })
        .filter(Boolean);

      if (!pairs.length) { cpToast('Nothing to copy — no fields are filled in', 'err'); return; }

      try {
        await navigator.clipboard.writeText(pairs.join('|'));
        cpToast(`✓ Copied ${pairs.length} field${pairs.length > 1 ? 's' : ''} to clipboard`);
      } catch {
        cpToast('Clipboard access denied', 'err');
      }
    });

    document.getElementById('creds-paste-all').addEventListener('click', async () => {
      let text;
      try {
        text = await navigator.clipboard.readText();
      } catch {
        cpToast('Clipboard access denied', 'err'); return;
      }

      if (!text?.trim()) { cpToast('Clipboard is empty', 'err'); return; }

      // Parse — split on | first, then on first colon only so URLs/tokens survive
      const updates = {};
      text.trim().split('|').forEach(chunk => {
        const colon = chunk.indexOf(':');
        if (colon === -1) return;
        const k = chunk.slice(0, colon).trim();
        const v = chunk.slice(colon + 1).trim();
        if (CP_KEYS.includes(k) && v) updates[k] = v;
      });

      if (!Object.keys(updates).length) {
        cpToast('No recognised fields found in clipboard', 'err'); return;
      }

      // Update visible fields
      let count = 0;
      Object.entries(updates).forEach(([k, v]) => {
        const el = document.getElementById(`creds-${k}`);
        if (el) { el.value = v; count++; }
      });

      // Persist to storage — merge with existing values for grouped keys
      const toSave = {};
      if (updates['intapp-host'] || updates['intapp-tenant'] || updates['intapp-client-id'] || updates['intapp-secret'] || updates['intapp-redirect']) {
        const existing = (await get(['intapp_credentials'])).intapp_credentials || {};
        toSave.intapp_credentials = {
          appHost:      updates['intapp-host']      || existing.appHost      || '',
          tenantId:     updates['intapp-tenant']    || existing.tenantId     || '',
          clientId:     updates['intapp-client-id'] || existing.clientId     || '',
          clientSecret: updates['intapp-secret']    || existing.clientSecret || '',
          redirectUri:  updates['intapp-redirect']  || existing.redirectUri  || '',
        };
      }
      if (updates['dnb-token'])    toSave.dnb_basic_token  = updates['dnb-token'];
      if (updates['geoapify-key']) toSave.geoapify_api_key = updates['geoapify-key'];
      if (updates['moodys-user'])  toSave.moodys_username  = updates['moodys-user'];
      if (updates['moodys-pass'])  toSave.moodys_password  = updates['moodys-pass'];
      if (updates['sp-user'])      toSave.sp_username      = updates['sp-user'];
      if (updates['sp-pass'])      toSave.sp_password      = updates['sp-pass'];
      if (updates['spx-user'])     toSave.spx_username     = updates['spx-user'];
      if (updates['spx-pass'])     toSave.spx_password     = updates['spx-pass'];

      if (Object.keys(toSave).length) await set(toSave);
      refreshDots();
      cpToast(`✓ Pasted ${count} field${count > 1 ? 's' : ''} — saved to storage`);
    });
  }

  // ── S&P Xpressapi token info panel ──────────────────────────────────────────
  function showSpxTokenInfo(tokenObj) {
    const el = document.getElementById('spx-token-info');
    if (!el) return;
    const expiresIn = Math.max(0, Math.round((tokenObj.expiresAt - Date.now()) / 1000));
    const mins = Math.floor(expiresIn / 60);
    const secs = expiresIn % 60;
    const expStr = expiresIn > 0
      ? `${mins}m ${secs}s remaining`
      : `<span style="color:#dc2626">Expired</span>`;
    const short = tokenObj.access_token.slice(0, 24) + '…';
    el.style.display = 'block';
    el.innerHTML = `
      <div><strong>Token:</strong> <code style="font-size:10px">${short}</code></div>
      ${tokenObj.refresh_token ? `<div><strong>Refresh:</strong> ✓ stored</div>` : ''}
      <div><strong>Expires:</strong> ${expStr}</div>`;
  }

  // ── Mount ────────────────────────────────────────────────────────────────────
  function mount(selector = '#credentials-root') {
    const root = document.querySelector(selector);
    if (!root) { console.error('[CredentialsManager] mount target not found:', selector); return; }
    root.innerHTML = TEMPLATE;
    wireButtons();
    loadFields();
    refreshDots();
  }

  // ── getSpxToken — returns a valid access_token, throws if missing/expired ────
  async function getSpxToken() {
    const s = await get(['spx_token']);
    const t = s.spx_token;
    if (!t?.access_token) throw new Error('NO_SPX_TOKEN');
    if (Date.now() >= t.expiresAt - 30000) throw new Error('SPX_TOKEN_EXPIRED');
    return t.access_token;
  }

  return { mount, get, set, remove, refreshDots, getSpxToken };
})();

// Auto-mount if the default anchor exists
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('credentials-root')) {
    CredentialsManager.mount();
  }
});
