/* =====================================================================
 * Celeste receiver — runs inside the Celeste iframe.
 *
 * Two jobs:
 *   1. Listen for { type: 'CELESTE_PASTE_AND_SEND', text } postMessages
 *      from the parent window and type them into Celeste's input.
 *   2. Watch Celeste's chat output for "tree-<partyId>" patterns and
 *      postMessage the parent to open the corporate tree panel.
 * ===================================================================== */

(function () {
  'use strict';
  if (window.__celesteReceiver) return;
  window.__celesteReceiver = true;

  const PARENT_ORIGIN = 'https://shalaka2-sand.opensandbox2.intapp.com';
  const ALLOWED_ORIGINS = [PARENT_ORIGIN];

  const TEXTAREA_SELECTORS = [
    'textarea[name="prompt-input"]',
    'textarea[placeholder*="something to work on" i]',
    'textarea[placeholder*="ask" i]',
    'textarea[placeholder*="message" i]',
    'textarea',
  ];

  const SEND_SELECTORS = [
    'button[type="submit"]',
    'button[aria-label="Send"]',
    'button[aria-label="Submit"]',
  ];

  function log(...a) { try { console.log('[Celeste-receiver]', ...a); } catch (_) {} }

  /* ---- wait for element ---- */
  function waitForElement(selectors, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const tryFind = () => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) return el;
        }
        return null;
      };
      const found = tryFind();
      if (found) return resolve(found);

      const observer = new MutationObserver(() => {
        const el = tryFind();
        if (el) { observer.disconnect(); clearTimeout(timer); resolve(el); }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`timeout waiting for ${selectors.join(' | ')}`));
      }, timeout);
    });
  }

  /* ---- React-friendly value setter ---- */
  function setNativeValue(element, value) {
    const proto = Object.getPrototypeOf(element);
    const valueSetter = Object.getOwnPropertyDescriptor(proto, 'value')
                     && Object.getOwnPropertyDescriptor(proto, 'value').set;
    const baseSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
                    && Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    if (valueSetter && valueSetter !== baseSetter) {
      baseSetter.call(element, value);
    } else if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }
  }

  /* ---- paste and send ---- */
  async function pasteAndSend(text) {
    log('pasteAndSend', text.slice(0, 80) + (text.length > 80 ? '…' : ''));
    let textarea;
    try {
      textarea = await waitForElement(TEXTAREA_SELECTORS);
    } catch (e) {
      log('could not find textarea', e.message);
      return;
    }

    textarea.focus();
    setNativeValue(textarea, text);
    textarea.dispatchEvent(new Event('input',  { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    let sendBtn = null;
    const form = textarea.closest('form, section, div');
    if (form) {
      for (const sel of SEND_SELECTORS) {
        sendBtn = form.querySelector(sel);
        if (sendBtn) break;
      }
    }
    if (!sendBtn) {
      for (const sel of SEND_SELECTORS) {
        sendBtn = document.querySelector(sel);
        if (sendBtn) break;
      }
    }

    setTimeout(() => {
      if (sendBtn) {
        log('clicking send button');
        if (sendBtn.disabled) sendBtn.disabled = false;
        sendBtn.click();
      } else {
        log('no send button — pressing Enter');
        textarea.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true,
        }));
      }
    }, 150);
  }

  /* ---- tree trigger watcher ---- */
  // Watches Celeste chat output for trigger patterns and tells the parent
  // to open the corporate tree panel with that party pre-loaded.
  //
  // Primary (natural language — configure in Celeste system prompt):
  //   "Let's take a look at the full corporate structure for Party Name (ID)"
  //   Small variations in wording are fine; what's matched is:
  //     corporate (structure|tree|family) for <Name> (<ID>)
  //
  // Manual / fallback formats:
  //   [open-tree: ID]   [tree: ID]   open_tree: ID   tree-ID
  //
  const TREE_RE = /corporate\s+(?:structure|tree|family)\s+for\s+.{1,80}?\(([A-Za-z0-9_-]+)\)|\[open-tree:\s*([A-Za-z0-9_-]+)\]|\[tree:\s*([A-Za-z0-9_-]+)\]|open[_-]tree:\s*([A-Za-z0-9_-]+)|\btree-([A-Za-z0-9_-]+)\b/i;
  let lastPartyId = null;
  let lastPartyTime = 0;

  function checkForTreeTrigger(text) {
    if (!text) return;
    const match = TREE_RE.exec(text);
    if (!match) return;
    // Pick whichever capture group matched
    const partyId = match[1] || match[2] || match[3] || match[4] || match[5];
    const now = Date.now();
    // Debounce: same party ID within 3 s is treated as one trigger
    if (partyId === lastPartyId && now - lastPartyTime < 3000) return;
    lastPartyId = partyId;
    lastPartyTime = now;
    try {
      window.parent.postMessage({ type: 'CELESTE_OPEN_TREE', partyId }, PARENT_ORIGIN);
    } catch (e) {
      log('postMessage to parent failed', e);
    }
  }

  function watchForTreeTriggers() {
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            checkForTreeTrigger(node.textContent);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = (node.tagName || '').toUpperCase();
            // Skip input areas — only watch chat output
            if (tag === 'INPUT' || tag === 'TEXTAREA') continue;
            if (node.isContentEditable) continue;
            checkForTreeTrigger(node.textContent);
          }
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* ---- inbound message listener (from parent) ---- */
  window.addEventListener('message', (event) => {
    if (!ALLOWED_ORIGINS.includes(event.origin)) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== 'CELESTE_PASTE_AND_SEND' || typeof data.text !== 'string') return;
    pasteAndSend(data.text);
  });

  // Start watching for tree triggers once the body is available
  if (document.body) {
    watchForTreeTriggers();
  } else {
    document.addEventListener('DOMContentLoaded', watchForTreeTriggers);
  }
})();
