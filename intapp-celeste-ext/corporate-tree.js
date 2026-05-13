// corporate-tree.js — intapp-celeste-ext
// Self-contained corporate family tree component.
// Same IIFE + auto-mount pattern as PR_EXT_credentials.js.
//
// USAGE:
//   <div id="tree-root"></div>
//   <script src="corporate-tree.js"></script>
//
// Or mount manually:
//   CorporateTree.mount('#tree-root', { onSelect, actionLabel, actionIcon })
//
// AUTH: reads intapp_token + intapp_credentials from chrome.storage.local
//       (set via the credentials extension)

const CorporateTree = (() => {

  // ── Storage (same as credentials component) ─────────────────────────────
  function storageGet(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }

  // ── API ────────────────────────────────────────────────────────────────────
  // Routed through the background service worker (uses stored OAuth token).
  async function fetchCorporateFamily(query) {
    console.log('[CorporateTree] fetching party', query);
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'FETCH_CORPORATE_FAMILY', partyId: query },
        (res) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(res);
        }
      );
    });
    if (!response.ok) throw new Error(response.error);
    const data = response.data;
    // Prefer BureauVanDijk tree; fall back to first available
    const tree = data.corporateTrees?.find(t => t.providerType === 'BureauVanDijk')
               ?? data.corporateTrees?.[0];
    if (!tree?.rootCompany) throw new Error('No corporate tree in response.');

    return flattenTree(tree.rootCompany, null);
  }

  // Recursively flatten the nested API tree into { id, name, parentId, countryCode, partyId }
  function flattenTree(node, parentId, result = []) {
    const id = node.externalId || node.partyId;
    result.push({
      id,
      name:        node.name        || '',
      parentId,
      countryCode: node.countryCode || '',
      partyId:     node.partyId     || '',
    });
    (node.subCompanies || node.children || []).forEach(child => flattenTree(child, id, result));
    return result;
  }

  // ── Tree builder ───────────────────────────────────────────────────────────
  function buildTree(nodes) {
    const map = {};
    nodes.forEach(n => { map[n.id] = { ...n, children: [] }; });
    const roots = [];
    nodes.forEach(n => {
      if (n.parentId && map[n.parentId]) map[n.parentId].children.push(map[n.id]);
      else roots.push(map[n.id]);
    });
    return roots;
  }

  // ── Styles ─────────────────────────────────────────────────────────────────
  const STYLES = `
    <style>
      .ct-root * { box-sizing: border-box; margin: 0; padding: 0; }
      .ct-root {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px; color: #1e293b; position: relative;
        display: flex; flex-direction: column; height: 100%;
      }

      .ct-header {
        padding: 14px 16px 10px;
        border-bottom: 1px solid #e2e8f0;
        background: #fff; flex-shrink: 0;
      }
      .ct-title {
        font-size: 11px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.6px; color: #6366f1; margin-bottom: 10px;
      }
      .ct-search-row { display: flex; gap: 7px; }
      .ct-input {
        flex: 1; padding: 7px 10px;
        border: 1.5px solid #e2e8f0; border-radius: 6px;
        font-size: 12px; font-family: inherit; color: #1e293b;
        background: #f8fafc; outline: none; transition: all 0.15s;
      }
      .ct-input:focus { border-color: #6366f1; background: #fff; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
      .ct-input::placeholder { color: #cbd5e1; }
      .ct-load-btn {
        padding: 7px 14px; border-radius: 6px; border: none;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: #fff; font-size: 12px; font-weight: 600;
        font-family: inherit; cursor: pointer; transition: opacity 0.15s;
        white-space: nowrap;
      }
      .ct-load-btn:hover { opacity: 0.88; }
      .ct-load-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      .ct-status {
        padding: 8px 16px; font-size: 11px; color: #94a3b8;
        font-style: italic; flex-shrink: 0;
      }
      .ct-status.err { color: #ef4444; font-style: normal; font-weight: 500; }

      .ct-tree { flex: 1; overflow-y: auto; padding: 8px 0 80px; }
      .ct-tree::-webkit-scrollbar { width: 4px; }
      .ct-tree::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }

      .ct-node { user-select: none; }
      .ct-node-row {
        display: flex; align-items: center; gap: 4px;
        padding: 4px 16px 4px 0; cursor: pointer;
        border-radius: 4px; transition: background 0.1s;
      }
      .ct-node-row:hover { background: #f1f5f9; }
      .ct-node-row.selected { background: #eef2ff; }

      .ct-indent { flex-shrink: 0; }
      .ct-toggle {
        width: 16px; height: 16px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        color: #94a3b8; font-size: 10px; border-radius: 3px;
        transition: color 0.1s;
      }
      .ct-toggle:hover { color: #6366f1; }
      .ct-toggle.leaf { pointer-events: none; color: transparent; }
      .ct-toggle.open::before   { content: '▾'; }
      .ct-toggle.closed::before { content: '▸'; }

      .ct-checkbox {
        width: 14px; height: 14px; flex-shrink: 0;
        border: 1.5px solid #cbd5e1; border-radius: 3px;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.12s; background: #fff;
      }
      .ct-checkbox.checked { background: #6366f1; border-color: #6366f1; }
      .ct-checkbox.checked::after {
        content: ''; width: 8px; height: 5px;
        border-left: 1.5px solid #fff; border-bottom: 1.5px solid #fff;
        transform: rotate(-45deg) translateY(-1px);
      }

      .ct-name {
        flex: 1; font-size: 12px; color: #1e293b;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ct-meta {
        font-size: 10px; color: #94a3b8; font-family: monospace;
        flex-shrink: 0; margin-left: 4px;
      }
      .ct-children.collapsed { display: none; }

      /* Selection bar */
      .ct-sel-bar {
        position: absolute; bottom: 0; left: 0; right: 0;
        padding: 10px 14px;
        background: #fff; border-top: 1px solid #e2e8f0;
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        transform: translateY(100%); transition: transform 0.2s ease;
        z-index: 10;
      }
      .ct-sel-bar.visible { transform: translateY(0); }
      .ct-sel-count { font-size: 11px; color: #64748b; }
      .ct-sel-count strong { color: #6366f1; }
      .ct-action-btn {
        padding: 8px 16px; border-radius: 7px; border: none;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: #fff; font-size: 12px; font-weight: 600; font-family: inherit;
        cursor: pointer; display: flex; align-items: center; gap: 6px;
        box-shadow: 0 2px 8px rgba(99,102,241,0.35); transition: all 0.15s;
      }
      .ct-action-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(99,102,241,0.4); }
    </style>
  `;

  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    selected:    new Set(),
    collapsed:   new Set(),
    nodes:       [],
    onSelect:    null,
    onLoad:      null,  // called with nodes[] after a successful tree load
    actionLabel: 'Send to Celeste',
    actionIcon:  '💬',
    _triggerLoad: null,  // set by mount() so loadParty() can fire it
  };

  // ── Render ───────────────────────────────────────────────────────────────
  function renderNode(node, depth = 0) {
    const isSelected  = state.selected.has(node.id);
    const isCollapsed = state.collapsed.has(node.id);
    const hasChildren = node.children?.length > 0;
    const toggleClass = hasChildren ? (isCollapsed ? 'closed' : 'open') : 'leaf';
    const indent = depth * 18;

    return `
      <div class="ct-node" data-id="${node.id}">
        <div class="ct-node-row ${isSelected ? 'selected' : ''}" data-row="${node.id}">
          <span class="ct-indent" style="width:${indent}px"></span>
          <span class="ct-toggle ${toggleClass}" data-toggle="${node.id}"></span>
          <span class="ct-checkbox ${isSelected ? 'checked' : ''}" data-check="${node.id}"></span>
          <span class="ct-name" title="${esc(node.name)}">${esc(node.name)}</span>
          <span class="ct-meta">${esc(node.countryCode)} ${esc(node.id)}</span>
        </div>
        <div class="ct-children ${isCollapsed ? 'collapsed' : ''}">
          ${hasChildren ? node.children.map(c => renderNode(c, depth + 1)).join('') : ''}
        </div>
      </div>`;
  }

  function renderTree(treeEl, roots) {
    treeEl.innerHTML = roots.map(r => renderNode(r, 0)).join('');

    treeEl.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.toggle;
        if (state.collapsed.has(id)) state.collapsed.delete(id);
        else state.collapsed.add(id);
        renderTree(treeEl, buildTree(state.nodes));
        updateSelBar();
      });
    });

    treeEl.querySelectorAll('[data-row]').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.dataset.toggle) return;
        const id = row.dataset.row;
        if (state.selected.has(id)) state.selected.delete(id);
        else state.selected.add(id);
        renderTree(treeEl, buildTree(state.nodes));
        updateSelBar();
      });
    });
  }

  function updateSelBar() {
    const bar = document.querySelector('.ct-sel-bar');
    const countEl = document.querySelector('.ct-sel-count');
    if (!bar) return;
    const n = state.selected.size;
    bar.classList.toggle('visible', n > 0);
    if (countEl) countEl.innerHTML = `<strong>${n}</strong> selected`;
  }

  // ── Mount ─────────────────────────────────────────────────────────────────
  function mount(selector = '#tree-root', opts = {}) {
    const root = document.querySelector(selector);
    if (!root) { console.error('[CorporateTree] mount target not found:', selector); return; }

    state.onSelect    = opts.onSelect    || null;
    state.onLoad      = opts.onLoad      || null;
    state.actionLabel = opts.actionLabel || 'Send to Celeste';
    state.actionIcon  = opts.actionIcon  || '💬';
    state.selected.clear();
    state.collapsed.clear();

    root.innerHTML = `
      ${STYLES}
      <div class="ct-root">
        <div class="ct-header">
          <div class="ct-title">Corporate Tree</div>
          <div class="ct-search-row">
            <input class="ct-input" id="ct-query" type="text"
              placeholder="Party ID (e.g. US123456)"
              autocomplete="off" spellcheck="false" />
            <button class="ct-load-btn" id="ct-load">Load</button>
          </div>
        </div>
        <div class="ct-status" id="ct-status">Enter a party ID to load its corporate family.</div>
        <div class="ct-tree" id="ct-tree"></div>
        <div class="ct-sel-bar">
          <span class="ct-sel-count" id="ct-sel-count"><strong>0</strong> selected</span>
          <button class="ct-action-btn" id="ct-action">
            <span>${state.actionIcon}</span>
            <span>${esc(state.actionLabel)}</span>
          </button>
        </div>
      </div>`;

    const queryInput = document.getElementById('ct-query');
    const loadBtn    = document.getElementById('ct-load');
    const statusEl   = document.getElementById('ct-status');
    const treeEl     = document.getElementById('ct-tree');
    const actionBtn  = document.getElementById('ct-action');

    async function load() {
      const query = queryInput.value.trim();
      if (!query) return;

      loadBtn.disabled = true;
      loadBtn.textContent = 'Loading…';
      statusEl.textContent = 'Fetching corporate family…';
      statusEl.className = 'ct-status';
      treeEl.innerHTML = '';
      state.selected.clear();
      state.collapsed.clear();
      updateSelBar();

      try {
        state.nodes = await fetchCorporateFamily(query);
        if (!state.nodes.length) { statusEl.textContent = 'No results found.'; return; }

        statusEl.textContent = `${state.nodes.length} entities — ${query}`;
        renderTree(treeEl, buildTree(state.nodes));
        if (state.onLoad) state.onLoad(state.nodes);
      } catch (err) {
        statusEl.textContent = `⚠ ${err.message}`;
        statusEl.className = 'ct-status err';
      } finally {
        loadBtn.disabled = false;
        loadBtn.textContent = 'Load';
      }
    }

    // Expose load trigger so loadParty() can fire it programmatically
    state._triggerLoad = (partyId) => {
      queryInput.value = partyId;
      load();
    };

    loadBtn.addEventListener('click', load);
    queryInput.addEventListener('keydown', e => { if (e.key === 'Enter') load(); });

    actionBtn.addEventListener('click', () => {
      if (!state.onSelect) return;
      const nodeMap = {};
      state.nodes.forEach(n => { nodeMap[n.id] = n; });
      // Selected entity shape — includes all IDs available from the API
      const entities = [...state.selected].map(id => {
        const n = nodeMap[id];
        return { id: n.id, partyId: n.partyId, name: n.name, countryCode: n.countryCode };
      }).filter(Boolean);
      state.onSelect({ entities, actionLabel: state.actionLabel });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Programmatically load a party by ID (called by content.js on tree trigger)
  function loadParty(partyId) {
    console.log('[CorporateTree] loadParty called', partyId, 'triggerLoad:', !!state._triggerLoad);
    if (state._triggerLoad) state._triggerLoad(partyId);
  }

  return { mount, loadParty };

})();

// Expose on window so other content scripts in the same extension can access it
window.CorporateTree = CorporateTree;

// Auto-mount if default anchor exists
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('tree-root')) {
    CorporateTree.mount('#tree-root', {
      onSelect: ({ entities }) => {
        // TODO: wire to Celeste chat / grid / conflicts
        console.log('[CorporateTree] selected:', entities);
      },
    });
  }
});
