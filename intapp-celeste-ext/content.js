/* =====================================================================
 * Celeste for Intapp Requests — content script
 *
 * Injects a "Celeste" button into the request page banner (.banner-tools)
 * and renders a side drawer with the Celeste iframe. A secondary corporate
 * tree panel extends to the left of Celeste and is triggered automatically
 * when the Celeste chat emits a message containing "tree-<partyId>".
 * ===================================================================== */

(function () {
  'use strict';

  if (window.__celesteInjected) return;
  window.__celesteInjected = true;

  console.log('[Celeste] content script v0.3.7 loaded');

  /* ---------------- stage-aware nudge config ---------------- */
  const STAGE_PROMPTS = {
    'Client': null,
    'Corporate Relationships': "Run AML/KYC Moody's GRID Playbook on this request to add client's corporate relationships for screening.",
    'Screening':              "Run AML/KYC Moody's GRID Playbook on this request to risk score Moody's GRID screening results.",
  };

  /* ---------------- inline SVG icon set ---------------- */
  const ICONS = {
    sparkle: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8L16.5 16.5l1.8-.7L19 14z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
    close:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    arrowUR: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>`,
  };

  /* ---------------- helpers ---------------- */
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of (Array.isArray(children) ? children : [children])) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  /* ---------------- URLs ---------------- */
  const CELESTE_ORIGIN = 'https://shalaka2-sand.my.intapp.com';
  const CELESTE_URL    = `${CELESTE_ORIGIN}/celeste/app`;

  /* ---------------- drawer markup ---------------- */
  function buildDrawer() {
    const root = el('div', { class: 'celeste-root', id: 'celeste-root' });

    // Backdrop
    const backdrop = el('div', { class: 'celeste-backdrop', 'aria-hidden': 'true' });
    backdrop.addEventListener('click', () => closeDrawer());
    root.appendChild(backdrop);

    // Drawers wrapper — flex row: [tree drawer][celeste drawer]
    const drawers = el('div', { class: 'celeste-drawers' });

    // ── Tree drawer (left of Celeste) ─────────────────────────────────────
    const treeDrawer = el('aside', {
      class: 'celeste-tree-drawer',
      role: 'complementary',
      'aria-label': 'Corporate Tree',
    });
    const treeInner = el('div', { class: 'celeste-tree-inner' });

    const treeCloseBtn = el('button', {
      type: 'button',
      class: 'celeste-tree-close',
      'aria-label': 'Close corporate tree',
      title: 'Close tree',
      html: ICONS.close,
    });
    treeCloseBtn.addEventListener('click', () => closeTreeDrawer());

    const treeRoot = el('div', { id: 'celeste-tree-root' });
    treeInner.appendChild(treeCloseBtn);
    treeInner.appendChild(treeRoot);
    treeDrawer.appendChild(treeInner);
    drawers.appendChild(treeDrawer);

    // ── Celeste drawer (right) ─────────────────────────────────────────────
    const drawer = el('aside', {
      class: 'celeste-drawer celeste-drawer--iframe',
      role: 'dialog',
      'aria-label': 'Celeste assistant',
      'aria-modal': 'false',
    });

    const closeBtn = el('button', {
      type: 'button',
      class: 'celeste-iframe-close',
      'aria-label': 'Close Celeste',
      title: 'Close',
      html: ICONS.close,
    });
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDrawer();
    });
    drawer.appendChild(closeBtn);

    const loader = el('div', { class: 'celeste-iframe-loader', html: '<span class="celeste-spinner"></span>' });
    drawer.appendChild(loader);

    const frame = el('iframe', {
      class: 'celeste-iframe',
      title: 'Celeste',
      allow: 'clipboard-read; clipboard-write',
    });
    frame.addEventListener('load', () => drawer.classList.add('celeste-iframe-loaded'));
    drawer.appendChild(frame);

    drawers.appendChild(drawer);
    root.appendChild(drawers);
    return root;
  }

  /* ---------------- request context from URL ---------------- */
  function readRequestContext() {
    try { return `URL: ${window.location.href}`; } catch (_) { return null; }
  }

  /* ---------------- open / close ---------------- */
  let drawerRoot = null;
  let treeMounted = false;

  function ensureDrawer() {
    if (drawerRoot && document.body.contains(drawerRoot)) return drawerRoot;
    drawerRoot = buildDrawer();
    document.body.appendChild(drawerRoot);

    // Mount the corporate tree component into the tree panel
    if (window.CorporateTree && !treeMounted) {
      treeMounted = true;
      window.CorporateTree.mount('#celeste-tree-root', {
        onLoad: () => {},
        onSelect: ({ entities }) => {
          // Forward selected entities to Celeste as a chat message
          const frame = drawerRoot && drawerRoot.querySelector('.celeste-iframe');
          if (!frame || !frame.contentWindow) return;
          const names = entities.map(e => e.name).join(', ');
          const text = `Selected corporate entities: ${names}\n${entities.map(e => `- ${e.name} (${e.id}, ${e.countryCode})`).join('\n')}`;
          try {
            frame.contentWindow.postMessage({ type: 'CELESTE_PASTE_AND_SEND', text }, CELESTE_ORIGIN);
          } catch (e) {
            console.warn('[Celeste] tree entity postMessage failed', e);
          }
        },
        actionLabel: 'Send to Celeste',
        actionIcon: '💬',
      });
    }
    return drawerRoot;
  }

  function openDrawer() {
    const root = ensureDrawer();
    const frame = root.querySelector('.celeste-iframe');

    requestAnimationFrame(() => root.classList.add('celeste-open'));

    const btn = document.getElementById('celeste-trigger-btn');
    const stagePrompt = btn && btn.dataset.stagePrompt ? btn.dataset.stagePrompt : null;
    const ctxString = readRequestContext();

    let payloadText = null;
    if (stagePrompt) {
      payloadText = `CONTEXT: ${ctxString}\n\nPROMPT: ${stagePrompt}`;
      if (btn) { delete btn.dataset.stagePrompt; delete btn.dataset.stage; }
    } else if (ctxString) {
      payloadText = `CONTEXT: ${ctxString}`;
    }
    const message = payloadText ? { type: 'CELESTE_PASTE_AND_SEND', text: payloadText } : null;

    function pushContext() {
      if (!message || !frame || !frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage(message, CELESTE_ORIGIN);
      } catch (e) {
        console.warn('[Celeste] postMessage failed', e);
      }
    }

    if (frame) {
      if (!frame.src) {
        frame.addEventListener('load', () => setTimeout(pushContext, 400), { once: true });
        frame.src = CELESTE_URL;
      } else {
        setTimeout(pushContext, 100);
      }
    }
  }

  function closeDrawer() {
    if (drawerRoot) {
      drawerRoot.classList.remove('celeste-open');
      drawerRoot.classList.remove('celeste-tree-open');
    }
  }

  function toggleDrawer() {
    if (drawerRoot && drawerRoot.classList.contains('celeste-open')) closeDrawer();
    else openDrawer();
  }

  // ── Tree drawer open/close ────────────────────────────────────────────────
  function openTreeDrawer(partyId) {
    if (!drawerRoot || !drawerRoot.classList.contains('celeste-open')) {
      openDrawer();
    } else {
      ensureDrawer();
    }
    // Open tree drawer immediately so loading state and errors are visible
    if (drawerRoot) requestAnimationFrame(() => drawerRoot.classList.add('celeste-tree-open'));
    if (partyId && window.CorporateTree) {
      setTimeout(() => window.CorporateTree.loadParty(partyId), 150);
    }
  }

  function closeTreeDrawer() {
    if (drawerRoot) drawerRoot.classList.remove('celeste-tree-open');
  }

  // Listen for tree trigger messages from the Celeste iframe receiver
  window.addEventListener('message', (event) => {
    console.log('[Celeste] message received', event.origin, event.data?.type);
    if (event.origin !== CELESTE_ORIGIN) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'CELESTE_OPEN_TREE' && data.partyId) {
      console.log('[Celeste] opening tree for', data.partyId);
      openTreeDrawer(data.partyId);
    }
  });

  // Test API from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'TEST_PARTY_API') {
      const url = `/api/api/common/v1/parties/${encodeURIComponent(msg.partyId)}?properties=CorporateFamily`;
      fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })
        .then(r => r.ok ? r.json() : r.text().then(t => { throw new Error(`${r.status}: ${t.replace(/<[^>]+>/g,' ').trim().slice(0,150)}`); }))
        .then(data => {
          const trees = data.corporateTrees;
          sendResponse({ ok: true, summary: trees
            ? `${trees.length} tree(s): ${trees.map(t => `${t.name} (${t.providerType})`).join(', ')}`
            : `No corporateTrees. Keys: ${Object.keys(data).join(', ')}` });
        })
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
  });

  // Esc to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerRoot && drawerRoot.classList.contains('celeste-open')) {
      closeDrawer();
    }
  });

  /* ---------------- stage detection + badge ---------------- */
  function readCurrentStage() {
    try {
      const titles = document.querySelectorAll('.overview-item-title-text');
      for (const t of titles) {
        if ((t.textContent || '').trim().replace(/:$/, '').toLowerCase() === 'stage') {
          const row = t.closest('tr');
          if (!row) continue;
          const valueEl = row.querySelector('.overview-item-value-text');
          if (valueEl) return (valueEl.textContent || '').trim();
        }
      }
    } catch (_) {}
    return null;
  }

  function buildInlineStageButton(stage, prompt) {
    const btn = el('button', {
      type: 'button',
      id: 'celeste-stage-btn',
      class: 'celeste-stage-btn',
      'aria-label': `Use Celeste for this stage (${stage})`,
      title: `Use Celeste for this stage (${stage})`,
      html: `<span class="celeste-stage-btn-letter">C</span>${ICONS.arrowUR}`,
    });
    btn.dataset.stage = stage;
    btn.dataset.stagePrompt = prompt;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const trigger = document.getElementById('celeste-trigger-btn');
      if (trigger) { trigger.dataset.stagePrompt = prompt; trigger.dataset.stage = stage; }
      openDrawer();
    });
    return btn;
  }

  function refreshStageButton() {
    const stage = readCurrentStage();
    const prompt = stage && Object.prototype.hasOwnProperty.call(STAGE_PROMPTS, stage)
      ? STAGE_PROMPTS[stage] : null;

    const existing = document.getElementById('celeste-stage-btn');
    if (!prompt) {
      if (existing) existing.remove();
      const trigger = document.getElementById('celeste-trigger-btn');
      if (trigger) { delete trigger.dataset.stagePrompt; delete trigger.dataset.stage; }
      return;
    }

    let valueEl = null;
    const titles = document.querySelectorAll('.overview-item-title-text');
    for (const t of titles) {
      if ((t.textContent || '').trim().replace(/:$/, '').toLowerCase() === 'stage') {
        const row = t.closest('tr');
        if (row) valueEl = row.querySelector('.overview-item-value-text');
        break;
      }
    }
    if (!valueEl) return;

    if (existing && existing.parentElement === valueEl.parentElement && existing.dataset.stage === stage) return;
    if (existing) existing.remove();

    const btn = buildInlineStageButton(stage, prompt);
    valueEl.appendChild(document.createTextNode(' '));
    valueEl.appendChild(btn);
  }

  function watchStage() {
    let scheduled = false;
    let suppress = false;
    function schedule() {
      if (scheduled || suppress) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        suppress = true;
        try { refreshStageButton(); } catch (_) {}
        setTimeout(() => { suppress = false; }, 0);
      }, 100);
    }
    schedule();
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const target = m.target;
        if (target && target.id === 'celeste-stage-btn') continue;
        if (target && target.closest && target.closest('#celeste-stage-btn')) continue;
        schedule();
        return;
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ---------------- trigger button injection ---------------- */
  function buildTrigger() {
    const btn = el('button', {
      type: 'button',
      id: 'celeste-trigger-btn',
      class: 'celeste-trigger',
      'aria-label': 'Open Celeste',
      title: 'Open Celeste',
      html: `${ICONS.sparkle}<span>Celeste</span>`,
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleDrawer();
    });
    return btn;
  }

  function injectTrigger() {
    if (document.getElementById('celeste-trigger-btn')) return true;
    const tools = document.querySelector('.banner-tools');
    if (!tools) return false;

    const trigger = buildTrigger();
    const helpIcon = tools.querySelector('#Y_X_flowHelp, .help-icon');
    const search   = tools.querySelector('.banner-search');
    if (helpIcon && helpIcon.parentElement === tools) {
      tools.insertBefore(trigger, helpIcon);
    } else if (search && search.parentElement === tools) {
      if (search.nextSibling) tools.insertBefore(trigger, search.nextSibling);
      else tools.appendChild(trigger);
    } else {
      tools.appendChild(trigger);
    }
    return true;
  }

  (function watchBanner() {
    let scheduled = false;
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        try { injectTrigger(); } catch (_) {}
      }, 200);
    }
    injectTrigger();
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const t = m.target;
        if (t && t.id === 'celeste-trigger-btn') continue;
        if (t && t.id === 'celeste-stage-btn')   continue;
        if (t && t.closest && (t.closest('#celeste-trigger-btn') || t.closest('#celeste-stage-btn'))) continue;
        schedule();
        return;
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  })();

  watchStage();
})();
