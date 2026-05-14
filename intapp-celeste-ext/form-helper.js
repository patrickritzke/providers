/* =====================================================================
 * form-helper.js — "Add from Tree" button on the grdTree question
 *
 * Injects a tree-icon button next to the native "Add Row" button on
 * the grdTree MultiColumnListInput question. Clicking it opens the
 * Celeste tree panel. When the user selects entities and clicks
 * "Add to Request Grid", content.js calls
 * window.__formHelper.onEntitiesSelected(entities), which GETs the
 * current answer, merges new rows (name + bbgId + bbgIdParent only),
 * and POSTs back via the Intapp answers API.
 * ===================================================================== */

(function () {
  'use strict';

  if (window.__formHelperInjected) return;
  window.__formHelperInjected = true;

  const CORP_TREE_Q_ID  = '19e1833affc-23c-c26130206d';
  const CORP_TREE_Q_SEL = `[data-question-id="${CORP_TREE_Q_ID}"]`;
  const BTN_MARKER      = 'celeste-add-row-btn';

  const TREE_ICON = `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
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

  // ── Helpers ─────────────────────────────────────────────────────────────

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

  // Append only entities not already present (dedup by bbgId).
  // Returns merged SimpleXml string, or null if nothing to add.
  function mergeIntoXml(existingXml, entities) {
    const existing    = parseExistingRows(existingXml);
    const existingIds = new Map(existing.map(r => [r.bbgId, r.rowId]));

    const toAdd = entities.filter(e => !existingIds.has(e.id));
    if (!toAdd.length) return null;

    // Topological sort so parents precede children within the new batch
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

      // GET all answers so we can find grdTree by questionId
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

  // ── Button injection ─────────────────────────────────────────────────────

  function injectBtn(questionEl) {
    if (questionEl.querySelector(`.${BTN_MARKER}`)) return;
    const nativeBtn = questionEl.querySelector('button.button.tertiary');
    if (!nativeBtn) return;

    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = `button tertiary ${BTN_MARKER}`;
    btn.innerHTML = TREE_ICON;
    btn.title     = 'Add corporate tree entities to grid';
    btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;padding:4px 8px;';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.__celeste?.openDrawer();
    });

    nativeBtn.parentElement.insertBefore(btn, nativeBtn.nextSibling);
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
