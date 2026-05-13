/* =====================================================================
 * Celeste receiver — runs inside the Celeste iframe.
 * Listens for { type: 'CELESTE_PASTE_AND_SEND', text } postMessages from
 * the parent window, types the text into Celeste's input, and clicks
 * send.
 *
 * Origin allowlist: only accepts messages from the Open subdomain.
 * ===================================================================== */

(function () {
  'use strict';
  if (window.__celesteReceiver) return;
  window.__celesteReceiver = true;

  const ALLOWED_ORIGINS = [
    'https://shalaka2-sand.opensandbox2.intapp.com'
  ];

  const TEXTAREA_SELECTORS = [
    'textarea[name="prompt-input"]',
    'textarea[placeholder*="something to work on" i]',
    'textarea[placeholder*="ask" i]',
    'textarea[placeholder*="message" i]',
    'textarea'
  ];

  const SEND_SELECTORS = [
    'button[type="submit"]',
    'button[aria-label="Send"]',
    'button[aria-label="Submit"]'
  ];

  function log(...a) { try { console.log('[Celeste-receiver]', ...a); } catch (_) {} }

  log('content script loaded on', location.href);

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
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`timeout waiting for ${selectors.join(' | ')}`));
      }, timeout);
    });
  }

  /* ---- React-friendly value setters ---- */
  function setNativeValue(element, value) {
    // React tracks input values via internal property; we have to invoke
    // the underlying setter so React notices the change.
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

  async function pasteAndSend(text) {
    log('pasteAndSend', text.slice(0, 80) + (text.length > 80 ? '…' : ''));
    let textarea;
    try {
      textarea = await waitForElement(TEXTAREA_SELECTORS);
    } catch (e) {
      log('could not find textarea', e.message);
      return;
    }
    log('textarea found', textarea);

    textarea.focus();
    setNativeValue(textarea, text);
    textarea.dispatchEvent(new Event('input',  { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    // Find a send button — prefer one inside the same form/section as the textarea
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

    // Wait a tick so React has processed the value change (and enabled the button)
    setTimeout(() => {
      if (sendBtn) {
        log('clicking send button');
        if (sendBtn.disabled) {
          // Some apps gate the disabled flag — try removing it as a fallback
          sendBtn.disabled = false;
        }
        sendBtn.click();
      } else {
        log('no send button found, trying Enter key');
        // Last-ditch: press Enter (without shift) on the textarea
        textarea.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
        }));
      }
    }, 150);
  }

  window.addEventListener('message', (event) => {
    if (!ALLOWED_ORIGINS.includes(event.origin)) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== 'CELESTE_PASTE_AND_SEND' || typeof data.text !== 'string') return;
    log('received message from', event.origin);
    pasteAndSend(data.text);
  });
})();
