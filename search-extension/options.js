const DEFAULT_MOODYS_URL = 'https://webservices.bvdinfo.com/v1.3/orbis4/remoteaccess.asmx';

// ── Load ──────────────────────────────────────────────────────────────────────
chrome.storage.local.get(['moodys_username','moodys_password','moodys_base_url','dnb_basic_token','sp_username','sp_password'], (r) => {
  document.getElementById('moodysUsername').value = r.moodys_username || '';
  document.getElementById('moodysPassword').value = r.moodys_password || '';
  document.getElementById('baseUrl').value        = r.moodys_base_url || '';
  document.getElementById('dnbBasicToken').value  = r.dnb_basic_token || '';
  document.getElementById('spUsername').value     = r.sp_username || '';
  document.getElementById('spPassword').value     = r.sp_password || '';
  updateBvdStatus(r.moodys_username, r.moodys_password, r.moodys_base_url);
  updateDnbStatus(r.dnb_basic_token);
  updateSpStatus(r.sp_username, r.sp_password);
});

// ── Moody's ───────────────────────────────────────────────────────────────────
document.getElementById('saveBvd').addEventListener('click', () => {
  const username = document.getElementById('moodysUsername').value.trim();
  const password = document.getElementById('moodysPassword').value;
  const baseUrl  = document.getElementById('baseUrl').value.trim();
  if (!username || !password) { showStatus('moodysStatus', 'Please enter username and password.', 'error'); return; }
  chrome.storage.local.set({ moodys_username: username, moodys_password: password, moodys_base_url: baseUrl }, () => {
    updateBvdStatus(username, password, baseUrl);
    showStatus('moodysStatus', '✓ Moody\u2019s credentials saved.', 'success');
  });
});

document.getElementById('clearBvd').addEventListener('click', () => {
  chrome.storage.local.remove(['moodys_username','moodys_password','moodys_base_url'], () => {
    document.getElementById('moodysUsername').value = '';
    document.getElementById('moodysPassword').value = '';
    document.getElementById('baseUrl').value = '';
    updateBvdStatus('','','');
    showStatus('moodysStatus', 'Moody\u2019s credentials cleared.', 'success');
  });
});

// ── D&B ───────────────────────────────────────────────────────────────────────
document.getElementById('saveDnb').addEventListener('click', () => {
  const basicToken = document.getElementById('dnbBasicToken').value.trim();
  if (!basicToken) { showStatus('dnbStatus', 'Please enter a Basic token.', 'error'); return; }
  chrome.storage.local.set({ dnb_basic_token: basicToken }, () => {
    updateDnbStatus(basicToken);
    showStatus('dnbStatus', '✓ D&B token saved.', 'success');
  });
});

document.getElementById('clearDnb').addEventListener('click', () => {
  chrome.storage.local.remove(['dnb_basic_token'], () => {
    document.getElementById('dnbBasicToken').value = '';
    updateDnbStatus('');
    showStatus('dnbStatus', 'D&B token cleared.', 'success');
  });
});

// ── S&P ───────────────────────────────────────────────────────────────────────
document.getElementById('saveSp').addEventListener('click', () => {
  const username = document.getElementById('spUsername').value.trim();
  const password = document.getElementById('spPassword').value;
  if (!username || !password) { showStatus('spStatus', 'Please enter username and password.', 'error'); return; }
  chrome.storage.local.set({ sp_username: username, sp_password: password }, () => {
    updateSpStatus(username, password);
    showStatus('spStatus', '✓ S&P credentials saved.', 'success');
  });
});

document.getElementById('clearSp').addEventListener('click', () => {
  chrome.storage.local.remove(['sp_username','sp_password'], () => {
    document.getElementById('spUsername').value = '';
    document.getElementById('spPassword').value = '';
    updateSpStatus('','');
    showStatus('spStatus', 'S&P credentials cleared.', 'success');
  });
});

// ── Toggle visibility ─────────────────────────────────────────────────────────
let moodysVis = false, dnbVis = false, spVis = false;
document.getElementById('toggleBvd').addEventListener('click', () => {
  moodysVis = !moodysVis;
  document.getElementById('moodysPassword').type = moodysVis ? 'text' : 'password';
  document.getElementById('toggleBvd').textContent = moodysVis ? '🙈' : '👁';
});
document.getElementById('toggleDnb').addEventListener('click', () => {
  dnbVis = !dnbVis;
  document.getElementById('dnbBasicToken').type = dnbVis ? 'text' : 'password';
  document.getElementById('toggleDnb').textContent = dnbVis ? '🙈' : '👁';
});
document.getElementById('toggleSp').addEventListener('click', () => {
  spVis = !spVis;
  document.getElementById('spPassword').type = spVis ? 'text' : 'password';
  document.getElementById('toggleSp').textContent = spVis ? '🙈' : '👁';
});

// ── Status indicators ─────────────────────────────────────────────────────────
function updateBvdStatus(username, password, baseUrl) {
  set('moodysUserStatus', username, 'set');
  set('moodysPassStatus', password, 'set');
  const urlEl = document.getElementById('moodysUrlStatus');
  urlEl.textContent = baseUrl ? '✓ Custom' : 'Default';
  urlEl.className = 'val ' + (baseUrl ? 'set' : 'unset');
}

function updateDnbStatus(basicToken) {
  set('dnbTokenStatus', basicToken, 'dnb-set');
}

function updateSpStatus(username, password) {
  set('spUserStatus', username, 'sp-set');
  set('spPassStatus', password, 'sp-set');
}

function set(id, val, cls) {
  const el = document.getElementById(id);
  el.textContent = val ? '✓ Set' : 'Not set';
  el.className = val ? ('val ' + cls) : 'val unset';
}

function showStatus(elId, msg, type) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.className = `status ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'status'; }, 3000);
}
