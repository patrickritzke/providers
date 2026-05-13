/* =====================================================================
 * Celeste SDK bridge — runs in the page's main world.
 *
 * Injected by content.js as <script src="...bridge.js">.
 * Loads the Celeste SDK, translates CustomEvents from the content
 * script into SDK calls, and re-emits SDK events back.
 *
 * Config via data-* on the script tag:
 *   data-sdk-src  — full URL of celeste-sdk.js
 *   data-panel-id — id of the host-provided container div
 *   data-platform — platform identifier ('open', 'dealcloud', etc.)
 * ===================================================================== */

(function () {
  if (window.__celesteBridge) return;
  window.__celesteBridge = true;

  function log(...a) { try { console.log('[Celeste-bridge]', ...a); } catch (_) {} }
  log('bridge script executing');

  const cur = document.currentScript;
  const cfg = {
    sdkSrc:   cur && cur.dataset.sdkSrc,
    panelId:  cur && cur.dataset.panelId,
    platform: cur && cur.dataset.platform,
  };
  if (!cfg.sdkSrc || !cfg.panelId || !cfg.platform) {
    log('missing config on script tag', cfg);
    return;
  }
  log('config', cfg);

  let sdkReady = false;
  let pendingOps = [];

  function loadSdk() {
    if (window.CelesteSDK) { log('SDK already on window'); onSdkLoaded(); return; }
    log('loading SDK from', cfg.sdkSrc);
    const s = document.createElement('script');
    s.src = cfg.sdkSrc;
    s.async = true;
    s.onload  = () => { log('SDK onload fired'); onSdkLoaded(); };
    s.onerror = (e) => log('SDK script failed to load', e);
    (document.head || document.documentElement).appendChild(s);
  }

  function onSdkLoaded() {
    if (!window.CelesteSDK) { log('CelesteSDK missing after script load'); return; }
    log('SDK loaded; calling init()');
    try {
      window.CelesteSDK.init({
        platform:      cfg.platform,
        idmToken:      '',
        containerMode: 'panel',
        containerId:   cfg.panelId,
      });
      log('init() returned');
    } catch (e) {
      log('init() threw', e);
    }
    sdkReady = true;

    log('flushing', pendingOps.length, 'pending op(s)');
    for (const op of pendingOps) { try { op(); } catch (e) { log('queued op failed', e); } }
    pendingOps = [];

    window.addEventListener('CELESTE_SDK_CANVAS_OPENED', () =>
      document.dispatchEvent(new CustomEvent('celeste-bridge:canvas-opened')));
    window.addEventListener('CELESTE_SDK_CANVAS_CLOSED', () =>
      document.dispatchEvent(new CustomEvent('celeste-bridge:canvas-closed')));
    window.addEventListener('CELESTE_SDK_CLOSE_REQUEST', () =>
      document.dispatchEvent(new CustomEvent('celeste-bridge:close-request')));
  }

  function run(fn) {
    if (sdkReady) { try { fn(); } catch (e) { log('op failed', e); } }
    else pendingOps.push(fn);
  }

  document.addEventListener('celeste-bridge:command', (e) => {
    const { type, payload } = (e.detail || {});
    log('command received', type, payload);
    run(() => {
      const sdk = window.CelesteSDK;
      if (!sdk) { log('SDK gone at execution time'); return; }
      switch (type) {
        case 'open':                sdk.open(payload || undefined); break;
        case 'close':               sdk.close();                    break;
        case 'setContext':          sdk.setContext(payload);        break;
        case 'clearContext':        sdk.clearContext();             break;
        case 'setSuggestedPrompts': sdk.setSuggestedPrompts(payload); break;
        case 'updateIdmToken':      sdk.updateIdmToken(payload);    break;
        default:                    log('unknown command', type);
      }
    });
  });

  loadSdk();
  log('bridge initialised; awaiting commands');
})();
