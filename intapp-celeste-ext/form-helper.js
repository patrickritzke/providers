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

  // Build the SimpleXml grid from a flat entity list.
  // Entities: { id (bbgId), name, parentId (parent bbgId or null) }
  // RowId is sequential; ParentRowId references the parent row's RowId
  // (empty when the parent isn't in the selection); bbgIdParent is always
  // the raw parent bbgId regardless of whether the parent is selected.
  function buildXml(entities) {
    const idSet = new Set(entities.map(e => e.id));

    // Topological sort so parents always precede their children
    const sorted = [];
    const visited = new Set();
    function visit(e) {
      if (visited.has(e.id)) return;
      if (e.parentId && idSet.has(e.parentId)) {
        const parent = entities.find(x => x.id === e.parentId);
        if (parent) visit(parent);
      }
      visited.add(e.id);
      sorted.push(e);
    }
    entities.forEach(e => visit(e));

    const rowIdOf = {};
    sorted.forEach((e, i) => { rowIdOf[e.id] = i; });

    const rows = sorted.map((e, i) => {
      const parentRowId = (e.parentId != null && rowIdOf[e.parentId] !== undefined)
        ? rowIdOf[e.parentId] : '';
      return `<GridRow>` +
        `<RowId>${i}</RowId>` +
        `<ParentRowId>${parentRowId}</ParentRowId>` +
        `<Question><Name>chkRestrict</Name><Value>False</Value></Question>` +
        `<Question><Name>name</Name><Value>${xmlEsc(e.name)}</Value></Question>` +
        `<Question><Name>bbgId</Name><Value>${xmlEsc(e.id)}</Value></Question>` +
        `<Question><Name>bbgIdParent</Name><Value>${xmlEsc(e.parentId || '')}</Value></Question>` +
        `<Question><Name></Name><Value></Value></Question>` +
        `</GridRow>`;
    }).join('');

    return `<Grid>${rows}</Grid>`;
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

      // GET current answer to retrieve answer id and questionId
      let answerId   = null;
      let questionId = null;
      try {
        const getRes = await fetch(
          `https://${host}/api/api/intake/v1/requests/${requestId}?questionNames=${GRID_Q_NAME}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
        );
        if (getRes.ok) {
          const data   = await getRes.json();
          const answer = data.answers?.find(a => a.questionName === GRID_Q_NAME);
          if (answer) { answerId = answer.id; questionId = answer.questionId; }
        }
      } catch (e) {
        console.warn('[form-helper] GET answer failed:', e.message);
      }

      const xml  = buildXml(entities);
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
