/* =====================================================================
 * form-helper.js — Intapp intake form: tree → grdTree API write
 *
 * Exposes window.__formHelper.onEntitiesSelected(entities), called by
 * content.js when the user clicks "Add to Form" in the tree panel.
 * Writes selected entities directly to the grdTree MultiColumnListInput
 * via POST /api/api/intake/v1/requests/{id}/answers.
 * ===================================================================== */

(function () {
  'use strict';

  if (window.__formHelperInjected) return;
  window.__formHelperInjected = true;

  const GRID_Q_NAME = 'grdTree';

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

  // Parse existing GridRows from SimpleXml, returning
  // { rowId, bbgId, raw } for each row.
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

  // Merge new entities into existing rows (append only, skip duplicates by bbgId).
  // Returns complete SimpleXml string.
  function mergeIntoXml(existingXml, entities) {
    const existing    = parseExistingRows(existingXml);
    const existingIds = new Map(existing.map(r => [r.bbgId, r.rowId]));

    // Only add entities not already present
    const toAdd = entities.filter(e => !existingIds.has(e.id));
    if (!toAdd.length) return null; // nothing to do

    // Topological sort so parents precede children within the new batch
    const addSet   = new Set(toAdd.map(e => e.id));
    const sorted   = [];
    const visited  = new Set();
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

    // New RowIds start after the highest existing RowId
    let nextRowId = existing.length
      ? Math.max(...existing.map(r => r.rowId)) + 1
      : 0;
    const newRowIdOf = {};
    sorted.forEach(e => { newRowIdOf[e.id] = nextRowId++; });

    const newRows = sorted.map(e => {
      let parentRowId = '';
      if (e.parentId != null) {
        if (existingIds.has(e.parentId))       parentRowId = existingIds.get(e.parentId);
        else if (newRowIdOf[e.parentId] != null) parentRowId = newRowIdOf[e.parentId];
      }
      return makeGridRow(newRowIdOf[e.id], parentRowId, e);
    });

    const allRows = existing.map(r => r.raw).concat(newRows).join('');
    return `<Grid>${allRows}</Grid>`;
  }

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

      // GET current answer to retrieve existing rows, answer id, and questionId
      let answerId    = null;
      let questionId  = null;
      let existingXml = null;
      try {
        const getRes = await fetch(
          `https://${host}/api/api/intake/v1/requests/${requestId}?questionNames=${GRID_Q_NAME}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
        );
        if (getRes.ok) {
          const data   = await getRes.json();
          const answer = data.answers?.find(a => a.questionName === GRID_Q_NAME);
          if (answer) {
            answerId    = answer.id;
            questionId  = answer.questionId;
            existingXml = answer.dataTableSimpleXmlAnswer || null;
          }
        }
      } catch (e) {
        console.warn('[form-helper] GET answer failed:', e.message);
      }

      const xml = mergeIntoXml(existingXml, entities);
      if (!xml) {
        console.log('[form-helper] all selected entities already in grid — nothing to add');
        return;
      }

      const body = [Object.assign(
        { questionName: GRID_Q_NAME, answerType: 'DataTable', dataTableSimpleXmlAnswer: xml },
        answerId   != null ? { id: answerId }  : {},
        questionId != null ? { questionId }    : {}
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

})();
