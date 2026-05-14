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

  // ── Storage ─────────────────────────────────────────────────────────────────
  function storageGet(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
  }

  // ── API ────────────────────────────────────────────────────────────────────
  async function fetchCorporateFamily(query) {
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
    const trees = data.corporateTrees?.filter(t => t.rootCompany);
    if (!trees?.length) throw new Error('No corporate tree in response.');

    const nodes = trees.flatMap(t => flattenTree(t.rootCompany, null));
    return { nodes, raw: data };
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

  // ── Tree builder ────────────────────────────────────────────────────────────
  function buildTree(nodes) {
    const map = {};
    nodes.forEach(n => { map[n.id] = { ...n, children: [] }; });
    const roots = [];
    nodes.forEach(n => {
      if (n.parentId && map[n.parentId]) map[n.parentId].children.push(map[n.id]);
      else roots.push(map[n.id]);
    });
    state._nodeMap = map;
    return roots;
  }

  // ── Tab definitions (order matters) ────────────────────────────────────────
  const TAB_DEFS = [
    { id: 'tree',         label: 'Tree' },
    { id: 'closeAff',     label: 'Close Aff' },
    { id: 'board',        label: 'Mgt/Board' },
    { id: 'shareholders', label: 'Shareholders' },
    { id: 'ubos',         label: 'UBOs' },
  ];

  // ── Styles ──────────────────────────────────────────────────────────────────
  const STYLES = `
    <style>
      .ct-root * { box-sizing: border-box; margin: 0; padding: 0; }
      .ct-root {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px; color: #1e293b; position: relative;
        display: flex; flex-direction: column; height: 100%;
      }

      .ct-header {
        padding: 10px 16px 8px;
        border-bottom: 1px solid #e2e8f0;
        background: #fff; flex-shrink: 0;
        display: flex; align-items: baseline; gap: 8px;
      }
      .ct-title {
        font-size: 11px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.6px; color: #6366f1; flex-shrink: 0;
      }
      .ct-party-id {
        font-size: 11px; color: #94a3b8; font-family: monospace;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      /* Tab bar */
      .ct-tabs {
        display: flex; flex-shrink: 0; overflow-x: auto;
        border-bottom: 1px solid #e2e8f0; background: #f8fafc;
        scrollbar-width: none;
      }
      .ct-tabs::-webkit-scrollbar { display: none; }
      .ct-tabs.hidden { display: none; }
      .ct-tab {
        flex-shrink: 0; padding: 7px 11px; margin-bottom: -1px;
        font-size: 11px; font-weight: 500; font-family: inherit;
        border: none; border-bottom: 2px solid transparent;
        background: none; cursor: pointer; color: #64748b;
        transition: all 0.15s; white-space: nowrap;
      }
      .ct-tab:hover { color: #6366f1; background: #f1f5f9; }
      .ct-tab.active { color: #6366f1; border-bottom-color: #6366f1; font-weight: 600; }

      /* Filter bar */
      .ct-filter-bar {
        display: flex; align-items: center; justify-content: space-between;
        flex-shrink: 0; padding: 5px 12px;
        background: #eef2ff; border-bottom: 1px solid #c7d2fe;
        font-size: 11px;
      }
      .ct-filter-bar.hidden { display: none; }
      .ct-filter-label { color: #4338ca; }
      .ct-filter-name { font-weight: 600; }
      .ct-filter-clear {
        border: none; background: none; cursor: pointer; font-size: 11px;
        color: #6366f1; font-family: inherit; padding: 2px 4px;
        border-radius: 3px; transition: background 0.1s;
      }
      .ct-filter-clear:hover { background: #c7d2fe; }

      .ct-status {
        padding: 8px 16px; font-size: 11px; color: #94a3b8;
        font-style: italic; flex-shrink: 0;
      }
      .ct-status.err { color: #ef4444; font-style: normal; font-weight: 500; }

      .ct-tree { flex: 1; overflow-y: auto; padding: 8px 0 80px; }
      .ct-tree::-webkit-scrollbar { width: 4px; }
      .ct-tree::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }

      /* Tree nodes */
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

      /* Checkbox + caret wrapper */
      .ct-chk-wrap { display: flex; align-items: center; flex-shrink: 0; }
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
      .ct-caret {
        width: 11px; height: 14px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        font-size: 8px; color: #cbd5e1; cursor: pointer;
        border-radius: 2px; transition: color 0.1s; line-height: 1;
      }
      .ct-caret:hover { color: #6366f1; }

      .ct-name {
        flex: 1; font-size: 12px; color: #1e293b;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ct-meta {
        font-size: 10px; color: #94a3b8; font-family: monospace;
        flex-shrink: 0; margin-left: 4px;
      }
      .ct-children.collapsed { display: none; }

      /* Flat section items (non-tree tabs) */
      .ct-section-item {
        display: flex; align-items: center; gap: 6px;
        padding: 5px 16px; cursor: pointer;
        border-radius: 4px; transition: background 0.1s;
        user-select: none;
      }
      .ct-section-item:hover { background: #f1f5f9; }
      .ct-section-item.selected { background: #eef2ff; }
      .ct-section-item .ct-name { flex: 1; font-size: 12px; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ct-section-item .ct-meta { font-size: 10px; color: #94a3b8; font-family: monospace; flex-shrink: 0; }

      /* Dropdown */
      .ct-dropdown {
        position: fixed; z-index: 99999;
        background: #fff; border: 1px solid #e2e8f0;
        border-radius: 7px; box-shadow: 0 4px 20px rgba(0,0,0,0.13);
        min-width: 180px; padding: 4px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .ct-dropdown-item {
        padding: 7px 12px; font-size: 12px; color: #1e293b;
        border-radius: 4px; cursor: pointer; transition: background 0.1s;
        white-space: nowrap;
      }
      .ct-dropdown-item:hover { background: #eef2ff; color: #6366f1; }

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

  // ── State ───────────────────────────────────────────────────────────────────
  const state = {
    selected:      new Set(),
    collapsed:     new Set(),
    nodes:         [],
    raw:           null,
    activeTab:     'tree',
    _tabData:      {},
    _nodeMap:      {},
    _sectionItems: {},
    _filterNodeId: null,
    _treeBound:    false,
    onSelect:      null,
    onLoad:        null,
    actionLabel:   'Send to Celeste',
    actionIcon:    '💬',
    _triggerLoad:  null,
  };

  // ── Tab data extraction ─────────────────────────────────────────────────────
  function extractTabData(raw) {
    const data = {};

    const ca = raw.closeAffiliates;
    if (Array.isArray(ca) && ca.length) {
      data.closeAff = ca.map(a => ({
        id: a.id || a.partyId || a.name, name: a.name || '', meta: a.countryCode || '',
      }));
    }

    const bm = raw.boardMembers?.boardMembers;
    if (Array.isArray(bm) && bm.length) {
      data.board = bm.map(m => ({ id: m.id, name: m.name || '', meta: m.title || '' }));
    }

    const sh = raw.shareholders;
    if (Array.isArray(sh) && sh.length) {
      data.shareholders = sh.map(s => ({
        id: s.id || s.partyId || s.name, name: s.name || '',
        meta: s.shareHoldingPercentage != null ? `${s.shareHoldingPercentage}%` : '',
      }));
    }

    const boFlat = flattenBeneficialOwners(raw.beneficialOwners?.beneficialOwners);
    if (boFlat.length) {
      data.ubos = boFlat.map(o => ({
        id: o.id, name: o.name, meta: o.pct != null ? `${o.pct}%` : '',
      }));
    }

    return data;
  }

  function flattenBeneficialOwners(list, result = []) {
    if (!Array.isArray(list)) return result;
    for (const bo of list) {
      result.push({ id: bo.id, name: bo.name || '', pct: bo.shareHoldingPercentage ?? null });
      flattenBeneficialOwners(bo.beneficialOwners, result);
    }
    return result;
  }

  function buildSectionItemMap(tabData) {
    const map = {};
    for (const key of ['closeAff', 'board', 'shareholders', 'ubos']) {
      if (!tabData[key]) continue;
      for (const item of tabData[key]) map[item.id] = { ...item, _section: key };
    }
    return map;
  }

  // ── Tree render ─────────────────────────────────────────────────────────────
  function renderNode(node, depth = 0) {
    const isSelected  = state.selected.has(node.id);
    const isCollapsed = state.collapsed.has(node.id);
    const hasChildren = node.children?.length > 0;
    const toggleClass = hasChildren ? (isCollapsed ? 'closed' : 'open') : 'leaf';
    const indent = depth * 18;
    const showCaret = !!node.parentId || hasChildren;

    return `
      <div class="ct-node" data-id="${node.id}">
        <div class="ct-node-row ${isSelected ? 'selected' : ''}" data-row="${node.id}">
          <span class="ct-indent" style="width:${indent}px"></span>
          <span class="ct-toggle ${toggleClass}" data-toggle="${node.id}"></span>
          <span class="ct-chk-wrap">
            <span class="ct-checkbox ${isSelected ? 'checked' : ''}" data-check="${node.id}"></span>${showCaret ? `<span class="ct-caret" data-caret="${node.id}">▾</span>` : ''}
          </span>
          <span class="ct-name" title="${esc(node.name)}${node.countryCode || node.id ? ' · ' + [node.countryCode, node.id].filter(Boolean).join(' ') : ''}">${esc(node.name)}</span>
        </div>
        <div class="ct-children ${isCollapsed ? 'collapsed' : ''}">
          ${hasChildren ? node.children.map(c => renderNode(c, depth + 1)).join('') : ''}
        </div>
      </div>`;
  }

  function renderTree(treeEl, roots) {
    treeEl.innerHTML = roots.map(r => renderNode(r, 0)).join('');
  }

  // Called once after mount — single delegated listener survives re-renders
  function bindTreeEvents(treeEl, filterBarEl) {
    treeEl.addEventListener('click', e => {
      // Caret → dropdown (must check before row)
      const caretEl = e.target.closest('[data-caret]');
      if (caretEl) {
        showNodeDropdown(caretEl.dataset.caret, caretEl, treeEl, filterBarEl);
        return;
      }

      // Toggle expand/collapse
      const toggleEl = e.target.closest('[data-toggle]');
      if (toggleEl) {
        const id = toggleEl.dataset.toggle;
        if (state.collapsed.has(id)) state.collapsed.delete(id);
        else state.collapsed.add(id);
        renderTree(treeEl, getTreeRoots());
        updateSelBar();
        return;
      }

      // Row → checkbox toggle
      const rowEl = e.target.closest('[data-row]');
      if (rowEl) {
        const id = rowEl.dataset.row;
        if (state.selected.has(id)) state.selected.delete(id);
        else state.selected.add(id);
        renderTree(treeEl, getTreeRoots());
        updateSelBar();
      }
    });
  }

  // ── Tab content render (for non-tree tabs) ──────────────────────────────────
  function renderTabContent(treeEl, items) {
    treeEl.innerHTML = items.map(item => {
      const isSelected = state.selected.has(item.id);
      return `
        <div class="ct-section-item ${isSelected ? 'selected' : ''}" data-section-item="${esc(item.id)}">
          <span class="ct-checkbox ${isSelected ? 'checked' : ''}" data-check="${esc(item.id)}"></span>
          <span class="ct-name" title="${esc(item.name)}">${esc(item.name)}</span>
          <span class="ct-meta">${esc(item.meta || '')}</span>
        </div>`;
    }).join('');

    treeEl.querySelectorAll('[data-section-item]').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.sectionItem;
        if (state.selected.has(id)) state.selected.delete(id);
        else state.selected.add(id);
        row.querySelector('.ct-checkbox')?.classList.toggle('checked', state.selected.has(id));
        row.classList.toggle('selected', state.selected.has(id));
        updateSelBar();
      });
    });
  }

  // ── Tabs ────────────────────────────────────────────────────────────────────
  function renderTabBar(tabsEl) {
    const available = { tree: true, ...Object.fromEntries(Object.keys(state._tabData).map(k => [k, true])) };
    tabsEl.innerHTML = TAB_DEFS
      .filter(t => available[t.id])
      .map(t => `<button class="ct-tab ${state.activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">${esc(t.label)}</button>`)
      .join('');
    tabsEl.classList.remove('hidden');
  }

  function switchTab(tabId, treeEl, tabsEl, filterBarEl) {
    state.activeTab = tabId;
    tabsEl.querySelectorAll('.ct-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    if (tabId === 'tree') {
      renderTree(treeEl, getTreeRoots());
    } else {
      // Filter only applies to tree tab
      filterBarEl.classList.add('hidden');
      renderTabContent(treeEl, state._tabData[tabId] || []);
    }
  }

  // ── Checkbox dropdown ───────────────────────────────────────────────────────
  function showNodeDropdown(nodeId, caretEl, treeEl, filterBarEl) {
    document.querySelectorAll('.ct-dropdown').forEach(d => d.remove());

    const node = state._nodeMap[nodeId];
    if (!node) return;

    const hasChildren = node.children?.length > 0;
    const options = [];

    if (node.parentId) {
      options.push({
        label: 'Select all parents',
        action() {
          let cur = state._nodeMap[node.parentId];
          while (cur) {
            state.selected.add(cur.id);
            cur = cur.parentId ? state._nodeMap[cur.parentId] : null;
          }
          renderTree(treeEl, getTreeRoots());
          updateSelBar();
        },
      });
    }

    if (hasChildren) {
      options.push({
        label: 'Select direct children',
        action() {
          node.children.forEach(c => state.selected.add(c.id));
          renderTree(treeEl, getTreeRoots());
          updateSelBar();
        },
      });
      options.push({
        label: 'Select all children',
        action() {
          selectAllDescendants(node);
          renderTree(treeEl, getTreeRoots());
          updateSelBar();
        },
      });
    }

    options.push({
      label: state._filterNodeId === nodeId ? 'Clear filter' : 'Filter to party',
      action() {
        if (state._filterNodeId === nodeId) clearFilter(treeEl, filterBarEl);
        else applyFilter(nodeId, treeEl, filterBarEl);
      },
    });

    if (!options.length) return;

    const dropdown = document.createElement('div');
    dropdown.className = 'ct-dropdown';
    for (const opt of options) {
      const item = document.createElement('div');
      item.className = 'ct-dropdown-item';
      item.textContent = opt.label;
      item.addEventListener('click', e => {
        e.stopPropagation();
        opt.action();
        dropdown.remove();
      });
      dropdown.appendChild(item);
    }
    document.body.appendChild(dropdown);

    const rect = caretEl.getBoundingClientRect();
    dropdown.style.top  = (rect.bottom + 2) + 'px';
    dropdown.style.left = rect.left + 'px';

    requestAnimationFrame(() => {
      document.addEventListener('click', () => dropdown.remove(), { once: true });
    });
  }

  function selectAllDescendants(node) {
    if (!node.children) return;
    for (const child of node.children) {
      state.selected.add(child.id);
      selectAllDescendants(child);
    }
  }

  // ── Filter to party ──────────────────────────────────────────────────────────
  function getFilterIds(nodeId) {
    // Need the full nodeMap — build from all nodes first
    buildTree(state.nodes);
    const ids = new Set([nodeId]);
    // ancestors
    let cur = state._nodeMap[nodeId];
    while (cur && cur.parentId) {
      ids.add(cur.parentId);
      cur = state._nodeMap[cur.parentId];
    }
    // descendants
    function addDesc(n) {
      for (const c of (n.children || [])) { ids.add(c.id); addDesc(c); }
    }
    addDesc(state._nodeMap[nodeId] || {});
    return ids;
  }

  function getTreeRoots() {
    if (!state._filterNodeId) return buildTree(state.nodes);
    const ids = getFilterIds(state._filterNodeId);
    return buildTree(state.nodes.filter(n => ids.has(n.id)));
  }

  function applyFilter(nodeId, treeEl, filterBarEl) {
    state._filterNodeId = nodeId;
    state.collapsed.clear();
    renderTree(treeEl, getTreeRoots());
    updateSelBar();
    const node = state._nodeMap[nodeId];
    filterBarEl.querySelector('.ct-filter-name').textContent = node ? node.name : nodeId;
    filterBarEl.classList.remove('hidden');
  }

  function clearFilter(treeEl, filterBarEl) {
    state._filterNodeId = null;
    filterBarEl.classList.add('hidden');
    renderTree(treeEl, getTreeRoots());
    updateSelBar();
  }

  // ── Misc ─────────────────────────────────────────────────────────────────────
  function updateSelBar() {
    const bar    = document.querySelector('.ct-sel-bar');
    const countEl = document.querySelector('.ct-sel-count');
    if (!bar) return;
    const n = state.selected.size;
    bar.classList.toggle('visible', n > 0);
    if (countEl) countEl.innerHTML = `<strong>${n}</strong> selected`;
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Mount ────────────────────────────────────────────────────────────────────
  function mount(selector = '#tree-root', opts = {}) {
    const root = document.querySelector(selector);
    if (!root) { console.error('[CorporateTree] mount target not found:', selector); return; }

    state.onSelect    = opts.onSelect    || null;
    state.onLoad      = opts.onLoad      || null;
    state.actionLabel = opts.actionLabel || 'Send to Celeste';
    state.actionIcon  = opts.actionIcon  || '💬';
    state.selected.clear();
    state.collapsed.clear();
    state.activeTab  = 'tree';
    state._treeBound = false;

    root.innerHTML = `
      ${STYLES}
      <div class="ct-root">
        <div class="ct-header">
          <div class="ct-title">Corporate Tree</div>
          <div class="ct-party-id" id="ct-party-id"></div>
        </div>
        <div class="ct-tabs hidden" id="ct-tabs"></div>
        <div class="ct-filter-bar hidden" id="ct-filter-bar">
          <span class="ct-filter-label">Filtered: <span class="ct-filter-name"></span></span>
          <button class="ct-filter-clear" id="ct-filter-clear">✕ Clear</button>
        </div>
        <div class="ct-status" id="ct-status">Waiting for party data…</div>
        <div class="ct-tree" id="ct-tree"></div>
        <div class="ct-sel-bar">
          <span class="ct-sel-count" id="ct-sel-count"><strong>0</strong> selected</span>
          <button class="ct-action-btn" id="ct-action">
            <span>${state.actionIcon}</span>
            <span>${esc(state.actionLabel)}</span>
          </button>
        </div>
      </div>`;

    const partyIdEl   = document.getElementById('ct-party-id');
    const statusEl    = document.getElementById('ct-status');
    const treeEl      = document.getElementById('ct-tree');
    const tabsEl      = document.getElementById('ct-tabs');
    const filterBarEl = document.getElementById('ct-filter-bar');
    const actionBtn   = document.getElementById('ct-action');

    document.getElementById('ct-filter-clear').addEventListener('click', () => {
      clearFilter(treeEl, filterBarEl);
    });

    async function load(partyId) {
      if (!partyId) return;

      partyIdEl.textContent = partyId;
      statusEl.textContent = 'Fetching corporate family…';
      statusEl.className = 'ct-status';
      treeEl.innerHTML = '';
      tabsEl.innerHTML = '';
      tabsEl.classList.add('hidden');
      filterBarEl.classList.add('hidden');
      state.selected.clear();
      state.collapsed.clear();
      state.activeTab     = 'tree';
      state._filterNodeId = null;
      updateSelBar();

      try {
        const result = await fetchCorporateFamily(partyId);
        state.nodes = result.nodes;
        state.raw   = result.raw;
        if (!state.nodes.length) { statusEl.textContent = 'No results found.'; return; }

        state._tabData      = extractTabData(state.raw);
        state._sectionItems = buildSectionItemMap(state._tabData);

        renderTabBar(tabsEl);
        tabsEl.querySelectorAll('.ct-tab').forEach(btn => {
          btn.addEventListener('click', () => switchTab(btn.dataset.tab, treeEl, tabsEl, filterBarEl));
        });

        statusEl.textContent = `${state.nodes.length} entities`;
        renderTree(treeEl, getTreeRoots());
        if (!state._treeBound) { bindTreeEvents(treeEl, filterBarEl); state._treeBound = true; }
        if (state.onLoad) state.onLoad(state.nodes);
      } catch (err) {
        statusEl.textContent = `⚠ ${err.message}`;
        statusEl.className = 'ct-status err';
      }
    }

    state._triggerLoad = (partyId) => load(partyId);

    actionBtn.addEventListener('click', () => {
      if (!state.onSelect) return;
      const nodeMap      = {};
      state.nodes.forEach(n => { nodeMap[n.id] = n; });
      const sectionItems = state._sectionItems || {};
      const entities = [...state.selected].map(id => {
        if (nodeMap[id]) {
          const n = nodeMap[id];
          return { id: n.id, partyId: n.partyId, name: n.name, countryCode: n.countryCode };
        }
        if (sectionItems[id]) {
          const s = sectionItems[id];
          return { id: s.id, name: s.name, meta: s.meta, _section: s._section };
        }
        return null;
      }).filter(Boolean);
      state.onSelect({ entities, actionLabel: state.actionLabel });
    });
  }

  // Programmatically load a party by ID (called by content.js on tree trigger)
  function loadParty(partyId) {
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
        console.log('[CorporateTree] selected:', entities);
      },
    });
  }
});
