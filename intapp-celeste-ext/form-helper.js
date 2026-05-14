/* =====================================================================
 * form-helper.js — Intapp intake form enhancements
 *
 * Injects helper buttons into specific form questions.
 * Currently: "Add from Tree" on the Corporate Tree table question.
 *
 * Architecture note: this file only handles DOM injection. Entity
 * selection data flows in via window.__formHelper.onEntitiesSelected(),
 * which content.js calls when the user acts on tree-panel selections.
 * ===================================================================== */

(function () {
  'use strict';

  if (window.__formHelperInjected) return;
  window.__formHelperInjected = true;

  // Question ID for the Corporate Tree MultiColumnListInput question.
  // If this changes between environments, check the data-question-id
  // attribute on the question element and update here.
  const CORP_TREE_Q_ID = '19692e5e843-22c-161ed376d1c';
  const CORP_TREE_Q_SEL = `[data-question-id="${CORP_TREE_Q_ID}"]`;
  const BTN_MARKER = 'celeste-add-row-btn';

  // ── Public API — called by content.js when tree entities are selected ──
  let _pendingEntities = null;
  window.__formHelper = {
    onEntitiesSelected(entities) {
      _pendingEntities = entities;
      // If the drawer is already open, pre-fill it immediately.
      // Otherwise the entities are stored and applied when the drawer opens.
      tryPrefillDrawer();
    },
  };

  // ── Drawer pre-fill ─────────────────────────────────────────────────────
  function tryPrefillDrawer() {
    if (!_pendingEntities?.length) return;
    const drawerContent = document.querySelector(
      `.drawer-grid-content[data-question-id="${CORP_TREE_Q_ID}"]`
    );
    if (!drawerContent) return;

    // TODO: map entity fields to drawer inputs once the field selectors
    // are known (Name, Alias, ID, Client ID). For now, log so it's easy
    // to inspect and wire up.
    console.log('[form-helper] drawer open with entities ready:', _pendingEntities);
    _pendingEntities = null;
  }

  // ── Button injection ────────────────────────────────────────────────────
  function injectBtn(questionEl) {
    if (questionEl.querySelector(`.${BTN_MARKER}`)) return;

    // The native "Add Row" button is inside app-grid-header.
    // It carries the Intapp "button tertiary" classes.
    const nativeBtn = questionEl.querySelector('button.button.tertiary');
    if (!nativeBtn) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `button tertiary ${BTN_MARKER}`;
    btn.textContent = 'Add from Tree';
    btn.title = 'Open the row editor (pre-fills from tree selection when entities are selected)';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      nativeBtn.click();
      // If entities were pre-selected in the tree panel, try to fill
      // the drawer once Angular finishes rendering its form fields.
      if (_pendingEntities?.length) {
        setTimeout(tryPrefillDrawer, 300);
      }
    });

    nativeBtn.parentElement.insertBefore(btn, nativeBtn.nextSibling);
  }

  // ── Persistent watcher ─────────────────────────────────────────────────
  // Angular re-renders app-grid-header on change detection, wiping the
  // injected button. The debounced MutationObserver re-injects it.
  (function watchQuestion() {
    let scheduled = false;

    function tryInject() {
      const questionEl = document.querySelector(CORP_TREE_Q_SEL);
      if (questionEl) injectBtn(questionEl);
    }

    function schedule() {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        try { tryInject(); } catch (_) {}
      }, 200);
    }

    tryInject();

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const t = m.target;
        // Skip mutations caused by our own button to avoid loops
        if (t && t.classList?.contains(BTN_MARKER)) continue;
        if (t && t.closest?.(`.${BTN_MARKER}`)) continue;
        schedule();
        return;
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  })();

})();
