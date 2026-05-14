/* =====================================================================
 * form-helper.js — tree-icon modal for the grdTree question
 *
 * Replaces the native "Add Row" button on the grdTree question with a
 * tree-icon button. Clicking opens a self-contained modal that mounts
 * CorporateTree. Selecting entities and clicking "Add to Request Grid"
 * GETs the current answer, merges new rows, and POSTs via the Intapp
 * answers API. Modal close dispatches 'celeste:tree-modal-closed' so
 * content.js can re-mount the tree into the Celeste drawer on next open.
 * ===================================================================== */

(function () {
  'use strict';

  if (window.__formHelperInjected) return;
  window.__formHelperInjected = true;

  const CORP_TREE_Q_ID  = '19e1833affc-23c-c26130206d';
  const CORP_TREE_Q_SEL = `[data-question-id="${CORP_TREE_Q_ID}"]`;
  const BTN_MARKER      = 'celeste-add-row-btn';
  const MODAL_TREE_ROOT = 'celeste-modal-tree-root';

  const TREE_ICON = `<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
    <rect x="7" y="1" width="6" height="4" rx="1"/>
    <line x1="10" y1="5" x2="10" y2="8"/>
    <line x1="4"  y1="8" x2="16" y2="8"/>
    <line x1="4"  y1="8" x2="4"  y2="11"/>
    <line x1="10" y1="8" x2="10" y2="11"/>
    <line x1="16" y1="8" x2="16" y2="11"/>
    <rect x="1"  y="11" width="6" height="4" rx="1"/>
    <rect x="7"  y="11" width="6" height="4" rx="1"/>
    <rect x="13" y="11" width="6" height="4" rx="1"/>
  </svg>`;

  const CLOSE_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  // ── API helpers ──────────────────────────────────────────────────────────

  function getRequestId() {
    const m = window.location.pathname.match(/\/requests\/(\d+)/);
    return m ? m[1] : null;
  }

  function storageGet(keys) {
    return new Promise(r => chrome.storage.local.get(keys, r));
  }

  function xmlEsc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function makeGridRow(rowId, parentRowId, entity) {
    return `<GridRow>` +
      `<RowId>${rowId}</RowId>` +
      `<ParentRowId>${parentRowId}</ParentRowId>` +
      `<Question><Name>chkRestrict</Name><Value>False</Value></Question>` +
      `<Question><Name>name</Name><Value>${xmlEsc(entity.name)}</Value></Question>` +
      `<Question><Name>bbgId</Name><Value>${xmlEsc(entity.id)}</Value></Question>` +
      `<Question><Name>bbgIdParent</Name><Value>${xmlEsc(entity.parentId || '')}</Value></Question>` +
      `<Question><Name></Name><Value></Value></Question>` +
      `</GridRow>`;
  }

  function parseExistingRows(xml) {
    if (!xml) return [];
    const rows = [];
    const re = /<GridRow>([\s\S]*?)<\/GridRow>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const inner  = m[1];
      const rowId  = parseInt((inner.match(/<RowId>(\d+)<\/RowId>/) || [])[1] ?? '-1');
      const bbgIdM = inner.match(/<Question><Name>bbgId<\/Name><Value>([^<]*)<\/Value><\/Question>/);
      rows.push({ rowId, bbgId: bbgIdM ? bbgIdM[1] : '', raw: m[0] });
    }
    return rows;
  }

  function mergeIntoXml(existingXml, entities) {
    const existing    = parseExistingRows(existingXml);
    const existingIds = new Map(existing.map(r => [r.bbgId, r.rowId]));

    const toAdd = entities.filter(e => !existingIds.has(e.id));
    if (!toAdd.length) return null;

    const addSet  = new Set(toAdd.map(e => e.id));
    const sorted  = [];
    const visited = new Set();
    function visit(e) {
      if (visited.has(e.id)) return;
      if (e.parentId && addSet.has(e.parentId)) {
        const parent = toAdd.find(x => x.id === e.parentId);
        if (parent) visit(parent);
      }
      visited.add(e.id);
      sorted.push(e);
    }
    toAdd.forEach(e => visit(e));

    let nextRowId = existing.length ? Math.max(...existing.map(r => r.rowId)) + 1 : 0;
    const newRowIdOf = {};
    sorted.forEach(e => { newRowIdOf[e.id] = nextRowId++; });

    const newRows = sorted.map(e => {
      let parentRowId = '';
      if (e.parentId != null) {
        if (existingIds.has(e.parentId))          parentRowId = existingIds.get(e.parentId);
        else if (newRowIdOf[e.parentId] != null)  parentRowId = newRowIdOf[e.parentId];
      }
      return makeGridRow(newRowIdOf[e.id], parentRowId, e);
    });

    return `<Grid>${existing.map(r => r.raw).concat(newRows).join('')}</Grid>`;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  window.__formHelper = {
    async onEntitiesSelected(entities) {
      if (!entities?.length) return;

      const requestId = getRequestId();
      if (!requestId) {
        console.error('[form-helper] Cannot extract request ID from URL:', window.location.pathname);
        return;
      }

      const stored = await storageGet(['intapp_token', 'intapp_credentials']);
      const token   = stored.intapp_token?.accessToken || stored.intapp_token?.token;
      const appHost = stored.intapp_credentials?.appHost;

      if (!token)   { console.error('[form-helper] No Intapp token — open the Celeste popup and Save & Test.'); return; }
      if (!appHost) { console.error('[form-helper] No Intapp appHost — open the Celeste popup and enter credentials.'); return; }

      const host = appHost.replace(/\/+$/, '');

      let answerId    = null;
      let questionName = null;
      let existingXml  = null;
      try {
        const getRes = await fetch(
          `https://${host}/api/api/intake/v1/requests/${requestId}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
        );
        if (getRes.ok) {
          const data   = await getRes.json();
          const answer = data.answers?.find(a => a.questionId === CORP_TREE_Q_ID);
          if (answer) {
            answerId     = answer.id;
            questionName = answer.questionName || null;
            existingXml  = answer.dataTableSimpleXmlAnswer || null;
          }
        }
      } catch (e) {
        console.warn('[form-helper] GET failed:', e.message);
      }

      const xml = mergeIntoXml(existingXml, entities);
      if (!xml) {
        console.log('[form-helper] all selected entities already in grid — nothing to add');
        return;
      }

      const body = [Object.assign(
        { questionId: CORP_TREE_Q_ID, answerType: 'DataTable', dataTableSimpleXmlAnswer: xml },
        answerId     != null ? { id: answerId }  : {},
        questionName != null ? { questionName }  : {}
      )];

      console.log('[form-helper] POSTing', entities.length, 'entities to grdTree on request', requestId);
      try {
        const postRes = await fetch(
          `https://${host}/api/api/intake/v1/requests/${requestId}/answers`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        );
        if (postRes.ok) {
          console.log('[form-helper] grdTree updated —', entities.length, 'rows written');
        } else {
          const err = await postRes.text();
          console.error('[form-helper] POST failed', postRes.status, err.slice(0, 300));
        }
      } catch (e) {
        console.error('[form-helper] POST error:', e.message);
      }
    },
  };

  // ── Modal ────────────────────────────────────────────────────────────────

  function openTreeModal() {
    if (document.getElementById('celeste-tree-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'celeste-tree-modal';
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:2147483640',
      'background:rgba(15,23,42,0.45)',
      'display:flex;align-items:center;justify-content:center',
    ].join(';');

    const modal = document.createElement('div');
    modal.style.cssText = [
      'width:480px;height:640px',
      'background:#fff;border-radius:12px',
      'box-shadow:0 24px 64px rgba(0,0,0,0.28)',
      'display:flex;flex-direction:column;overflow:hidden',
    ].join(';');

    // Header
    const header = document.createElement('div');
    header.style.cssText = [
      'display:flex;align-items:center;justify-content:space-between',
      'padding:11px 14px;flex-shrink:0',
      'background:linear-gradient(135deg,#1e293b,#334155)',
      'border-bottom:1px solid rgba(255,255,255,0.08)',
    ].join(';');
    header.innerHTML = `<span style="color:#fff;font-size:13px;font-weight:600;letter-spacing:0.1px;">Corporate Tree</span>`;

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = CLOSE_ICON;
    closeBtn.title = 'Close';
    closeBtn.style.cssText = [
      'background:none;border:none;cursor:pointer;padding:4px',
      'color:rgba(255,255,255,0.6);display:flex;align-items:center',
      'border-radius:4px;transition:color 0.15s',
    ].join(';');
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#fff'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = 'rgba(255,255,255,0.6)'; });
    header.appendChild(closeBtn);

    // Party ID bar
    const partyBar = document.createElement('div');
    partyBar.style.cssText = 'display:flex;gap:7px;padding:8px 10px;border-bottom:1px solid #e2e8f0;background:#f8fafc;flex-shrink:0;';

    const partyInput = document.createElement('input');
    partyInput.type = 'text';
    partyInput.placeholder = 'Party ID (e.g. 1764)';
    partyInput.autocomplete = 'off';
    partyInput.style.cssText = [
      'flex:1;padding:6px 10px;border:1.5px solid #e2e8f0;border-radius:6px',
      'font-size:12px;font-family:inherit;color:#1e293b;background:#fff;outline:none',
    ].join(';');
    partyInput.addEventListener('focus', () => { partyInput.style.borderColor = '#6366f1'; });
    partyInput.addEventListener('blur',  () => { partyInput.style.borderColor = '#e2e8f0'; });

    const loadBtn = document.createElement('button');
    loadBtn.textContent = 'Load';
    loadBtn.style.cssText = [
      'padding:6px 14px;border-radius:6px;border:none;white-space:nowrap',
      'background:linear-gradient(135deg,#6366f1,#8b5cf6)',
      'color:#fff;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer',
    ].join(';');

    partyBar.appendChild(partyInput);
    partyBar.appendChild(loadBtn);

    // Tree root
    const treeRoot = document.createElement('div');
    treeRoot.id = MODAL_TREE_ROOT;
    treeRoot.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;';

    modal.appendChild(header);
    modal.appendChild(partyBar);
    modal.appendChild(treeRoot);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function closeModal() {
      overlay.remove();
      // Let content.js know the tree is free to be re-mounted in the Celeste drawer
      document.dispatchEvent(new CustomEvent('celeste:tree-modal-closed'));
    }

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onEsc); }
    });

    // Mount corporate tree into modal
    window.CorporateTree.mount(`#${MODAL_TREE_ROOT}`, {
      actionLabel: 'Add to Request Grid',
      onSelect: ({ entities }) => {
        window.__formHelper.onEntitiesSelected(entities);
        closeModal();
      },
    });

    function triggerLoad() {
      const id = partyInput.value.trim();
      if (!id) return;
      loadBtn.disabled = true;
      loadBtn.textContent = 'Loading…';
      window.CorporateTree.loadParty(id);
      setTimeout(() => { loadBtn.disabled = false; loadBtn.textContent = 'Load'; }, 3000);
    }
    loadBtn.addEventListener('click', triggerLoad);
    partyInput.addEventListener('keydown', e => { if (e.key === 'Enter') triggerLoad(); });
    setTimeout(() => partyInput.focus(), 50);
  }

  // ── Button injection (replaces native "Add Row") ─────────────────────────

  function injectBtn(questionEl) {
    const nativeBtn = questionEl.querySelector('button.button.tertiary:not(.celeste-add-row-btn)');

    // Keep native hidden whenever our button is present
    if (questionEl.querySelector(`.${BTN_MARKER}`)) {
      if (nativeBtn) nativeBtn.style.display = 'none';
      return;
    }
    if (!nativeBtn) return;

    nativeBtn.style.display = 'none';

    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = `button tertiary ${BTN_MARKER}`;
    btn.innerHTML = TREE_ICON;
    btn.title     = 'Add corporate tree entities to grid';
    btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;padding:4px 8px;';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTreeModal();
    });

    nativeBtn.parentElement.insertBefore(btn, nativeBtn);
  }

  (function watchQuestion() {
    let scheduled = false;
    function tryInject() {
      const questionEl = document.querySelector(CORP_TREE_Q_SEL);
      if (questionEl) injectBtn(questionEl);
    }
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => { scheduled = false; try { tryInject(); } catch (_) {} }, 200);
    }
    tryInject();
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const t = m.target;
        if (t && t.classList?.contains(BTN_MARKER))  continue;
        if (t && t.closest?.(`.${BTN_MARKER}`))      continue;
        schedule();
        return;
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  })();

})();
