/* =====================================================================
 * form-helper.js — inject "Add from Tree" on all grid questions
 *
 * Injects a button next to the native "Add Row" button on every
 * MultiColumnListInput question on the page. Clicking it records
 * the target question's data-question-id and opens the Celeste tree
 * panel. When the user selects entities and clicks "Add to Form",
 * content.js calls window.__formHelper.onEntitiesSelected(entities),
 * which GETs the current answer, merges new rows, and POSTs back.
 * ===================================================================== */

(function () {
  'use strict';

  if (window.__formHelperInjected) return;
  window.__formHelperInjected = true;

  const BTN_MARKER = 'celeste-add-row-btn';

  // The question whose grid the next "Add to Form" action will target.
  // Set when the user clicks "Add from Tree" on a specific question.
  let _targetQuestionId = null;

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

      if (!_targetQuestionId) {
        console.error('[form-helper] No target question — click "Add from Tree" on a grid question first.');
        return;
      }

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

      // GET all answers so we can find this question by questionId
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
          const answer = data.answers?.find(a => a.questionId === _targetQuestionId);
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
        { questionId: _targetQuestionId, answerType: 'DataTable', dataTableSimpleXmlAnswer: xml },
        answerId     != null ? { id: answerId }   : {},
        questionName != null ? { questionName }   : {}
      )];

      console.log('[form-helper] POSTing', entities.length, 'entities to question', _targetQuestionId, 'on request', requestId);
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
          console.log('[form-helper] grid updated —', entities.length, 'rows written');
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
  // Inject "Add from Tree" next to the native "Add Row" button on every
  // grid question (any [data-question-id] that has a button.button.tertiary).

  function injectBtn(questionEl) {
    if (questionEl.querySelector(`.${BTN_MARKER}`)) return;
    const nativeBtn = questionEl.querySelector('button.button.tertiary');
    if (!nativeBtn) return;

    const questionId = questionEl.dataset.questionId;

    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = `button tertiary ${BTN_MARKER}`;
    btn.textContent = 'Add from Tree';
    btn.title = 'Select entities in the corporate tree panel and add them to this grid';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _targetQuestionId = questionId;
      window.__celeste?.openDrawer();
    });

    nativeBtn.parentElement.insertBefore(btn, nativeBtn.nextSibling);
  }

  function tryInjectAll() {
    document.querySelectorAll('[data-question-id]').forEach(injectBtn);
  }

  (function watchQuestions() {
    let scheduled = false;
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        try { tryInjectAll(); } catch (_) {}
      }, 200);
    }

    tryInjectAll();

    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const t = m.target;
        if (t && t.classList?.contains(BTN_MARKER))   continue;
        if (t && t.closest?.(`.${BTN_MARKER}`))       continue;
        schedule();
        return;
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  })();

})();
