// popup.js — initialization for credentials.html
// Chrome MV3 blocks inline <script> in extension pages; this replaces that block.

// ── Tab switching ──────────────────────────────────────────────────────────
document.querySelectorAll('.popup-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.popup-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.popup-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.panel).classList.add('active');
  });
});

// ── Mount corporate tree into popup ───────────────────────────────────────
CorporateTree.mount('#popup-tree-root', {
  onSelect: ({ entities }) => {
    console.log('[popup] selected entities:', entities);
  },
});

// ── Party ID input (popup-only) ───────────────────────────────────────────
const partyInput = document.getElementById('popup-party-id');
const loadBtn    = document.getElementById('popup-load-btn');

function triggerLoad() {
  const id = partyInput.value.trim();
  if (!id) return;
  loadBtn.disabled = true;
  loadBtn.textContent = 'Loading…';
  CorporateTree.loadParty(id);
  setTimeout(() => { loadBtn.disabled = false; loadBtn.textContent = 'Load'; }, 3000);
}

loadBtn.addEventListener('click', triggerLoad);
partyInput.addEventListener('keydown', e => { if (e.key === 'Enter') triggerLoad(); });
