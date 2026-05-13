/* =====================================================================
 * Celeste for Intapp Requests — content script
 *
 * Injects a "Celeste" button into the request.aspx page banner
 * (.banner-tools) and renders a side drawer with a chat-style UI.
 * The drawer is a non-functional mock: textbox is editable but the
 * send button and playbook list are wired to no-ops.
 * ===================================================================== */

(function () {
  'use strict';

  if (window.__celesteInjected) return;
  window.__celesteInjected = true;

  /* ---------------- stage-aware nudge config ----------------
   * Map of request-stage value → prompt to auto-send when the user
   * clicks the Celeste button.
   *
   *   null      → no badge for this stage (button behaves normally)
   *   "string"  → red dot appears; click sends "PROMPT: <string>"
   *
   * Stage values are the literal text inside .overview-item-value-text
   * for the row whose label is "Stage:".
   * ---------------------------------------------------------- */
  const STAGE_PROMPTS = {
    'Client': null,
    'Corporate Relationships': "Run AML/KYC Moody's GRID Playbook on this request to add client's corporate relationships for screening.",
    'Screening':              "Run AML/KYC Moody's GRID Playbook on this request to risk score Moody's GRID screening results.",
    // Examples for later:
    // 'Conflicts':        'Run the conflicts review playbook for this request',
    // 'Risk Review':      'Initiate AML/KYC screening for this client',
    // 'Onboarding':       'Walk me through onboarding tasks for this client',
  };

  /* ---------------- inline SVG icon set ---------------- */
  const ICONS = {
    sparkle: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8L16.5 16.5l1.8-.7L19 14z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
    export:  `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.33" d="M18 10h4m0 0v4m0-4-7.333 7.333M20 16.667v4A1.334 1.334 0 0 1 18.667 22h-7.334A1.334 1.334 0 0 1 10 20.667v-7.334A1.334 1.334 0 0 1 11.333 12h4"/></svg>`,
    chats:   `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M14 10C14 10.3536 13.8595 10.6928 13.6095 10.9428C13.3594 11.1929 13.0203 11.3333 12.6667 11.3333H4.66667L2 14V3.33333C2 2.97971 2.14048 2.64057 2.39052 2.39052C2.64057 2.14048 2.97971 2 3.33333 2H12.6667C13.0203 2 13.3594 2.14048 13.6095 2.39052C13.8595 2.64057 14 2.97971 14 3.33333V10Z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    minus:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    close:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    arrowUR: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>`,
    clip:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"/></svg>`,
    notepad: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M12 2v4"/><path d="M16 2v4"/><rect width="16" height="18" x="4" y="4" rx="2"/><path d="M8 10h6"/><path d="M8 14h8"/><path d="M8 18h5"/></svg>`,
    knife:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v1c0 1 2 1 2 2S3 6 3 7s2 1 2 2-2 1-2 2 2 1 2 2"/><path d="M18 6h.01"/><path d="M6 18h.01"/><path d="M20.83 8.83a4 4 0 0 0-5.66-5.66l-12 12a4 4 0 1 0 5.66 5.66Z"/><path d="M18 11.66V22a4 4 0 0 0 4-4V6"/></svg>`,
    arrowUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>`
  };

  // Connector dot icons (shamrock / hexagon / globe — match user's source markup)
  const CONN_ICONS = {
    a: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAxOCAxOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTMuNzcxNSAxMC45ODU0TDkuMDA2OTEgMTUuNzVMNC4yNDI0MiAxMC45ODU1QzMuNzEyMDYgMTAuNDU1MiAzLjQxOTk4IDkuNzUwMDcgMy40MTk5OCA5QzMuNDIwMDEgOC4yNDk5OCAzLjcxMjA5IDcuNTQ0ODIgNC4yNDI0OCA3LjAxNDQyTDkuMDA2OTEgMi4yNUwxMy43NzE0IDcuMDE0NDZDMTQuMzAxNyA3LjU0NDgyIDE0LjU5MzggOC4yNDk5MyAxNC41OTM4IDlDMTQuNTkzOCA5Ljc0OTkzIDE0LjMwMTggMTAuNDU1IDEzLjc3MTUgMTAuOTg1NFoiIGZpbGw9IiMwRTU0QTkiLz48L3N2Zz4=',
    b: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAxOCAxOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTUuMzUyNyA2LjM1Mjc0TDkuMDAwMDEgLTIuNjgyMjFlLTA3TDIuNjQ3MzYgNi4zNTI2NUMxLjk0MDIyIDcuMDU5NzkgMS41NTA3OCA3Ljk5OTkyIDEuNTUwNzggOUMxLjU1MDgyIDEwIDEuOTQwMjYgMTAuOTQwMiAyLjY0NzQ0IDExLjY0NzRMOS4wMDAwMSAxOEwxNS4zNTI2IDExLjY0NzRDMTYuMDU5OCAxMC45NDAyIDE2LjQ0OTIgMTAuMDAwMSAxNi40NDkyIDlDMTYuNDQ5MiA3Ljk5OTkyIDE2LjA1OTggNy4wNTk5OSAxNS4zNTI3IDYuMzUyNzRaIiBmaWxsPSIjMjA3Q0VDIi8+PC9zdmc+',
    c: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTUuNSA4QzE1LjUgMTIuMTQyMSAxMi4xNDIxIDE1LjUgOCAxNS41TTE1LjUgOEMxNS41IDMuODU3ODYgMTIuMTQyMSAwLjUgOCAwLjVNMTUuNSA4SDAuNU04IDE1LjVDMy44NTc4NiAxNS41IDAuNSAxMi4xNDIxIDAuNSA4TTggMTUuNUM2LjA3NDE4IDEzLjQ3NzkgNSAxMC43OTI0IDUgOEM1IDUuMjA3NTYgNi4wNzQxOCAyLjUyMjEyIDggMC41TTggMTUuNUM5LjkyNTgyIDEzLjQ3NzkgMTEgMTAuNzkyNCAxMSA4QzExIDUuMjA3NTYgOS45MjU4MiAyLjUyMjEyIDggMC41TTAuNSA4QzAuNSAzLjg1Nzg2IDMuODU3ODYgMC41IDggMC41IiBzdHJva2U9IiMxRTI5M0IiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg=='
  };

  // Intapp Governance wordmark (from user's source markup)
  const GOVERNANCE_LOGO = `<svg width="117" height="21" viewBox="0 0 117 21" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Intapp Governance" role="img"><path d="M16.6008 10.5135C15.5969 15.7811 12.8717 19.3081 8.5 21C4.12826 19.3081 1.40309 15.7811 0.399194 10.5135C-0.00288672 8.40423 -0.030296 6.42989 0.0173671 5.14528C0.0552531 4.12826 0.144816 3.37044 0.191432 3.02952C0.507265 2.78271 1.30375 2.19659 2.44696 1.6094C3.81365 0.907492 5.97246 0.0591488 8.5 0C11.0275 0.0591488 13.1863 0.907492 14.553 1.6094C15.6964 2.19677 16.4931 2.78289 16.8086 3.02952C16.8552 3.37062 16.9447 4.12826 16.9826 5.14528C17.0303 6.43007 17.0029 8.40423 16.6008 10.5135Z" fill="#0E54A9"/><path d="M6.52399 8.20438V6.80971C6.52399 5.70433 7.39974 4.80526 8.47643 4.80526C9.55313 4.80526 10.4289 5.70433 10.4289 6.80971V8.20438H6.52399ZM9.1212 11.5806C9.03984 11.66 8.94451 11.7245 8.83941 11.7698V13.1987C8.83941 13.3014 8.7989 13.3943 8.73343 13.4617C8.66778 13.5289 8.57735 13.5705 8.47731 13.5705C8.27758 13.5705 8.11538 13.404 8.11538 13.1987V11.767C8.0129 11.7218 7.92001 11.6583 7.8404 11.5806C7.66337 11.407 7.55303 11.1624 7.55303 10.8914C7.55303 10.3653 7.9682 9.93889 8.4808 9.93889C8.99305 9.93889 9.4084 10.3653 9.4084 10.8914C9.4084 11.1626 9.29823 11.407 9.1212 11.5806ZM11.3717 8.25708V6.80971C11.3717 5.98897 11.0478 5.24583 10.5239 4.70793C9.99973 4.17003 9.27606 3.83736 8.47643 3.83736C6.87754 3.83736 5.58121 5.16822 5.58121 6.80971V8.27016C4.86294 8.47736 4.33673 9.15471 4.33673 9.95825V13.6519C4.33673 14.6205 5.10144 15.4055 6.04492 15.4055H10.9551C11.8986 15.4055 12.6633 14.6205 12.6633 13.6519V9.95825C12.6633 9.13733 12.1138 8.44797 11.3717 8.25708Z" fill="#F7F6F5"/><path d="M25.5607 7.128C25.3047 7.136 25.1167 7.192 24.9967 7.296C24.8767 7.392 24.8007 7.536 24.7687 7.728C24.7367 7.912 24.7207 8.156 24.7207 8.46V13.392C24.7207 13.608 24.7167 13.804 24.7087 13.98C24.7087 14.148 24.7007 14.284 24.6847 14.388C24.8207 14.372 24.9687 14.364 25.1287 14.364C25.2967 14.356 25.4407 14.348 25.5607 14.34V15H22.6087V14.472C22.8727 14.456 23.0607 14.4 23.1727 14.304C23.2927 14.208 23.3687 14.064 23.4007 13.872C23.4327 13.68 23.4487 13.436 23.4487 13.14V8.148C23.4487 7.972 23.4527 7.804 23.4607 7.644C23.4687 7.476 23.4767 7.332 23.4847 7.212C23.3487 7.22 23.2007 7.228 23.0407 7.236C22.8807 7.244 22.7367 7.252 22.6087 7.26V6.6H25.5607V7.128ZM26.6019 15V14.496C26.8419 14.496 27.0099 14.44 27.1059 14.328C27.2019 14.216 27.2579 14.06 27.2739 13.86C27.2979 13.66 27.3099 13.428 27.3099 13.164L27.3219 10.668C27.3219 10.54 27.3219 10.404 27.3219 10.26C27.3299 10.108 27.3459 9.96 27.3699 9.816C27.2259 9.824 27.0779 9.832 26.9259 9.84C26.7819 9.84 26.6459 9.844 26.5179 9.852V9.216C26.8779 9.216 27.1579 9.2 27.3579 9.168C27.5659 9.128 27.7219 9.084 27.8259 9.036C27.9379 8.988 28.0219 8.936 28.0779 8.88H28.5099C28.5179 8.952 28.5219 9.02 28.5219 9.084C28.5299 9.148 28.5339 9.216 28.5339 9.288C28.5419 9.36 28.5499 9.452 28.5579 9.564C28.7339 9.42 28.9259 9.292 29.1339 9.18C29.3419 9.068 29.5579 8.98 29.7819 8.916C30.0139 8.844 30.2339 8.808 30.4419 8.808C31.1539 8.808 31.6659 9.024 31.9779 9.456C32.2979 9.888 32.4579 10.564 32.4579 11.484V13.512C32.4579 13.656 32.4539 13.804 32.4459 13.956C32.4379 14.1 32.4259 14.248 32.4099 14.4C32.5379 14.392 32.6659 14.388 32.7939 14.388C32.9299 14.38 33.0539 14.372 33.1659 14.364V15H30.4899V14.496C30.7299 14.496 30.8979 14.44 30.9939 14.328C31.0899 14.216 31.1459 14.06 31.1619 13.86C31.1859 13.66 31.1979 13.428 31.1979 13.164V11.484C31.1899 10.852 31.0859 10.376 30.8859 10.056C30.6939 9.736 30.3819 9.58 29.9499 9.588C29.6939 9.588 29.4419 9.652 29.1939 9.78C28.9459 9.908 28.7379 10.064 28.5699 10.248C28.5699 10.328 28.5699 10.416 28.5699 10.512C28.5699 10.6 28.5699 10.692 28.5699 10.788V13.512C28.5699 13.656 28.5659 13.804 28.5579 13.956C28.5499 14.1 28.5379 14.248 28.5219 14.4C28.6499 14.392 28.7779 14.388 28.9059 14.388C29.0419 14.38 29.1659 14.372 29.2779 14.364V15H26.6019ZM36.2064 15.192C36.0064 15.192 35.8024 15.164 35.5944 15.108C35.3944 15.06 35.2104 14.96 35.0424 14.808C34.8744 14.648 34.7424 14.42 34.6464 14.124C34.5504 13.828 34.5024 13.436 34.5024 12.948L34.5264 9.672H33.6384V9C33.8544 8.992 34.0744 8.912 34.2984 8.76C34.5224 8.608 34.7184 8.404 34.8864 8.148C35.0544 7.892 35.1704 7.616 35.2344 7.32H35.7984V9H37.6464V9.624L35.7984 9.648L35.7744 12.852C35.7744 13.156 35.7984 13.424 35.8464 13.656C35.9024 13.88 35.9904 14.056 36.1104 14.184C36.2384 14.304 36.4104 14.364 36.6264 14.364C36.8104 14.364 36.9984 14.308 37.1904 14.196C37.3904 14.084 37.5784 13.9 37.7544 13.644L38.1624 14.004C37.9704 14.284 37.7784 14.504 37.5864 14.664C37.3944 14.824 37.2104 14.94 37.0344 15.012C36.8584 15.092 36.6984 15.14 36.5544 15.156C36.4104 15.18 36.2944 15.192 36.2064 15.192ZM42.2123 15C42.1963 14.872 42.1843 14.76 42.1763 14.664C42.1683 14.568 42.1563 14.468 42.1403 14.364C41.8683 14.636 41.5763 14.844 41.2643 14.988C40.9523 15.124 40.6283 15.192 40.2923 15.192C39.7163 15.192 39.2803 15.052 38.9843 14.772C38.6963 14.484 38.5523 14.128 38.5523 13.704C38.5523 13.336 38.6603 13.016 38.8763 12.744C39.0923 12.472 39.3763 12.252 39.7283 12.084C40.0803 11.908 40.4643 11.78 40.8803 11.7C41.2963 11.612 41.7043 11.568 42.1043 11.568V10.86C42.1043 10.604 42.0803 10.368 42.0323 10.152C41.9843 9.928 41.8843 9.748 41.7323 9.612C41.5883 9.468 41.3603 9.396 41.0483 9.396C40.8403 9.388 40.6323 9.428 40.4243 9.516C40.2163 9.596 40.0563 9.732 39.9443 9.924C40.0083 9.988 40.0483 10.064 40.0643 10.152C40.0883 10.232 40.1003 10.308 40.1003 10.38C40.1003 10.492 40.0523 10.62 39.9563 10.764C39.8603 10.9 39.6963 10.964 39.4643 10.956C39.2723 10.956 39.1243 10.892 39.0203 10.764C38.9243 10.628 38.8763 10.472 38.8763 10.296C38.8763 10.008 38.9803 9.752 39.1883 9.528C39.4043 9.304 39.6963 9.128 40.0643 9C40.4323 8.872 40.8443 8.808 41.3003 8.808C41.9883 8.808 42.5003 8.988 42.8363 9.348C43.1803 9.708 43.3523 10.276 43.3523 11.052C43.3523 11.34 43.3523 11.616 43.3523 11.88C43.3523 12.144 43.3483 12.408 43.3403 12.672C43.3403 12.936 43.3403 13.216 43.3403 13.512C43.3403 13.632 43.3363 13.768 43.3283 13.92C43.3203 14.072 43.3083 14.232 43.2923 14.4C43.4283 14.392 43.5683 14.384 43.7123 14.376C43.8563 14.368 43.9923 14.364 44.1203 14.364V15H42.2123ZM42.1043 12.12C41.8483 12.136 41.5843 12.172 41.3123 12.228C41.0483 12.284 40.8083 12.368 40.5923 12.48C40.3763 12.592 40.2003 12.736 40.0643 12.912C39.9363 13.088 39.8723 13.3 39.8723 13.548C39.8883 13.82 39.9763 14.02 40.1363 14.148C40.3043 14.276 40.5003 14.34 40.7243 14.34C41.0043 14.34 41.2523 14.288 41.4683 14.184C41.6843 14.072 41.8963 13.92 42.1043 13.728C42.0963 13.64 42.0923 13.552 42.0923 13.464C42.0923 13.368 42.0923 13.268 42.0923 13.164C42.0923 13.092 42.0923 12.96 42.0923 12.768C42.1003 12.568 42.1043 12.352 42.1043 12.12Z" fill="#0E54A9"/></svg>`;

  /* ---------------- helpers ---------------- */
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of (Array.isArray(children) ? children : [children])) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  /* ---------------- drawer markup (manual iframe) ---------------- */
  const CELESTE_ORIGIN = 'https://shalaka2-sand.my.intapp.com';
  const CELESTE_URL    = `${CELESTE_ORIGIN}/celeste/app`;

  function buildDrawer() {
    const root = el('div', { class: 'celeste-root', id: 'celeste-root' });

    // backdrop
    const backdrop = el('div', { class: 'celeste-backdrop', 'aria-hidden': 'true' });
    backdrop.addEventListener('click', () => closeDrawer());
    root.appendChild(backdrop);

    // drawer
    const drawer = el('aside', {
      class: 'celeste-drawer celeste-drawer--iframe',
      role: 'dialog',
      'aria-label': 'Celeste assistant',
      'aria-modal': 'false'
    });

    // Floating close button
    const closeBtn = el('button', {
      type: 'button',
      class: 'celeste-iframe-close',
      'aria-label': 'Close Celeste',
      title: 'Close',
      html: ICONS.close
    });
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDrawer();
    });
    drawer.appendChild(closeBtn);

    // Loading overlay shown until the iframe load event fires
    const loader = el('div', { class: 'celeste-iframe-loader', html: '<span class="celeste-spinner"></span>' });
    drawer.appendChild(loader);

    // The iframe itself. src is set on first open (lazy) so we don't pay
    // the load cost until the user actually opens the drawer.
    const frame = el('iframe', {
      class: 'celeste-iframe',
      title: 'Celeste',
      allow: 'clipboard-read; clipboard-write'
    });
    frame.addEventListener('load', () => {
      drawer.classList.add('celeste-iframe-loaded');
    });
    drawer.appendChild(frame);

    root.appendChild(drawer);
    return root;
  }

  /* ---------------- request context from URL ---------------- */
  function readRequestContext() {
    try {
      return `URL: ${window.location.href}`;
    } catch (_) {
      return null;
    }
  }

  /* ---------------- open / close ---------------- */
  let drawerRoot = null;

  function ensureDrawer() {
    if (drawerRoot && document.body.contains(drawerRoot)) return drawerRoot;
    drawerRoot = buildDrawer();
    document.body.appendChild(drawerRoot);
    return drawerRoot;
  }

  function openDrawer() {
    const root = ensureDrawer();
    const drawer = root.querySelector('.celeste-drawer');
    const frame  = root.querySelector('.celeste-iframe');

    // Slide the drawer in
    requestAnimationFrame(() => root.classList.add('celeste-open'));

    const btn = document.getElementById('celeste-trigger-btn');
    const stagePrompt = btn && btn.dataset.stagePrompt ? btn.dataset.stagePrompt : null;
    const ctxString = readRequestContext();

    // Header button: just CONTEXT (URL)
    // Inline stage button: CONTEXT + PROMPT
    let payloadText = null;
    if (stagePrompt) {
      payloadText = `CONTEXT: ${ctxString}\n\nPROMPT: ${stagePrompt}`;
      // Consume the prompt so a subsequent header click doesn't re-fire it
      if (btn) {
        delete btn.dataset.stagePrompt;
        delete btn.dataset.stage;
      }
    } else if (ctxString) {
      payloadText = `CONTEXT: ${ctxString}`;
    }
    const message = payloadText ? { type: 'CELESTE_PASTE_AND_SEND', text: payloadText } : null;

    function pushContext() {
      if (!message || !frame || !frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage(message, CELESTE_ORIGIN);
        console.log('[Celeste] context pushed to iframe', message);
      } catch (e) {
        console.warn('[Celeste] postMessage failed', e);
      }
    }

    if (frame) {
      if (!frame.src) {
        // First open — set src and push context once load fires
        frame.addEventListener('load', () => {
          // Slight delay so the in-iframe content script has time to register
          setTimeout(pushContext, 400);
        }, { once: true });
        frame.src = CELESTE_URL;
      } else {
        // Already loaded — push immediately
        setTimeout(pushContext, 100);
      }
    }
  }

  function closeDrawer() {
    if (drawerRoot) drawerRoot.classList.remove('celeste-open');
  }

  function toggleDrawer() {
    if (drawerRoot && drawerRoot.classList.contains('celeste-open')) closeDrawer();
    else openDrawer();
  }

  // Esc to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerRoot && drawerRoot.classList.contains('celeste-open')) {
      closeDrawer();
    }
  });

  /* ---------------- stage detection + badge ---------------- */
  /**
   * Read the current request stage from the page.
   * Looks for the .overview-item-title-text containing "Stage:" and
   * returns the trimmed text of the sibling .overview-item-value-text.
   */
  function readCurrentStage() {
    try {
      const titles = document.querySelectorAll('.overview-item-title-text');
      for (const t of titles) {
        if ((t.textContent || '').trim().replace(/:$/, '').toLowerCase() === 'stage') {
          // Walk up to the row, then find the value cell
          const row = t.closest('tr');
          if (!row) continue;
          const valueEl = row.querySelector('.overview-item-value-text');
          if (valueEl) return (valueEl.textContent || '').trim();
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * Build the small inline "C↗" button that sits next to the Stage value.
   */
  function buildInlineStageButton(stage, prompt) {
    const btn = el('button', {
      type: 'button',
      id: 'celeste-stage-btn',
      class: 'celeste-stage-btn',
      'aria-label': `Use Celeste to complete this stage (${stage})`,
      title: `Use Celeste to complete this stage (${stage})`,
      html: `<span class="celeste-stage-btn-letter">C</span>${ICONS.arrowUR}`
    });
    btn.dataset.stage = stage;
    btn.dataset.stagePrompt = prompt;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Open drawer with stage prompt — temporarily mark the trigger so
      // openDrawer() picks up the prompt from there (existing wiring).
      const trigger = document.getElementById('celeste-trigger-btn');
      if (trigger) {
        trigger.dataset.stagePrompt = prompt;
        trigger.dataset.stage = stage;
      }
      openDrawer();
    });
    return btn;
  }

  /**
   * Inject or remove the inline stage button based on the current stage
   * and the STAGE_PROMPTS map.
   */
  function refreshStageButton() {
    const stage = readCurrentStage();
    const prompt = stage && Object.prototype.hasOwnProperty.call(STAGE_PROMPTS, stage)
      ? STAGE_PROMPTS[stage]
      : null;

    const existing = document.getElementById('celeste-stage-btn');

    if (!prompt) {
      // Remove if present and the current stage doesn't warrant one
      if (existing) existing.remove();
      // Also clear any leftover dataset on the header trigger so a stale
      // prompt doesn't fire on the next manual click.
      const trigger = document.getElementById('celeste-trigger-btn');
      if (trigger) {
        delete trigger.dataset.stagePrompt;
        delete trigger.dataset.stage;
      }
      return;
    }

    // Find the value cell to attach to
    let valueEl = null;
    const titles = document.querySelectorAll('.overview-item-title-text');
    for (const t of titles) {
      if ((t.textContent || '').trim().replace(/:$/, '').toLowerCase() === 'stage') {
        const row = t.closest('tr');
        if (row) valueEl = row.querySelector('.overview-item-value-text');
        break;
      }
    }
    if (!valueEl) {
      // Stage cell not yet in the DOM — try again on the next mutation
      return;
    }

    // If the existing button is already next to the right cell with the
    // same stage, leave it alone (avoid re-creating on every mutation).
    if (existing && existing.parentElement === valueEl.parentElement
        && existing.dataset.stage === stage) {
      return;
    }
    if (existing) existing.remove();

    const btn = buildInlineStageButton(stage, prompt);
    // Insert just after the value cell text — append into the value cell
    // so it sits inline with "Client" / "Corporate Relationships" / etc.
    valueEl.appendChild(document.createTextNode(' '));
    valueEl.appendChild(btn);
  }

  /**
   * Watch for stage changes — observe the overview area so we re-apply
   * the inline button when the page updates the stage cell.
   *
   * Guarded against the feedback loop where our own DOM mutations
   * (inserting/removing the stage button) re-trigger the observer.
   */
  function watchStage() {
    let scheduled = false;
    let suppress = false;

    function schedule() {
      if (scheduled || suppress) return;
      scheduled = true;
      // Defer to next microtask + small debounce so a burst of mutations
      // collapses into one apply()
      setTimeout(() => {
        scheduled = false;
        suppress = true;
        try { refreshStageButton(); } catch (_) {}
        // Release the suppress flag after the browser has flushed our
        // own mutation records
        setTimeout(() => { suppress = false; }, 0);
      }, 100);
    }

    schedule(); // initial
    const obs = new MutationObserver((mutations) => {
      // Ignore mutations whose target/added node is our own button
      for (const m of mutations) {
        const target = m.target;
        if (target && target.id === 'celeste-stage-btn') continue;
        if (target && target.closest && target.closest('#celeste-stage-btn')) continue;
        schedule();
        return;
      }
    });
    obs.observe(document.documentElement, {
      childList: true,
      subtree: true
      // characterData: false — childList catches stage text changes
    });
  }

  /* ---------------- trigger button injection ---------------- */
  function buildTrigger() {
    const btn = el('button', {
      type: 'button',
      id: 'celeste-trigger-btn',
      class: 'celeste-trigger',
      'aria-label': 'Open Celeste',
      title: 'Open Celeste',
      html: `${ICONS.sparkle}<span>Celeste</span>`
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleDrawer();
    });
    return btn;
  }

  function injectTrigger() {
    if (document.getElementById('celeste-trigger-btn')) return true;
    const tools = document.querySelector('.banner-tools');
    if (!tools) return false;

    const trigger = buildTrigger();

    // Place the button just before the help icon (#Y_X_flowHelp), so it
    // sits in the right-side cluster: [search] [Celeste] [?] [avatar].
    // Fall back to before .banner-search if help icon isn't there yet.
    const helpIcon = tools.querySelector('#Y_X_flowHelp, .help-icon');
    const search   = tools.querySelector('.banner-search');
    if (helpIcon && helpIcon.parentElement === tools) {
      tools.insertBefore(trigger, helpIcon);
    } else if (search && search.parentElement === tools) {
      // Insert AFTER the search box, not before
      if (search.nextSibling) tools.insertBefore(trigger, search.nextSibling);
      else tools.appendChild(trigger);
    } else {
      tools.appendChild(trigger);
    }
    return true;
  }

  /* ---------------- watch for the banner ---------------- */
  (function watchBanner() {
    let scheduled = false;
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        try { injectTrigger(); } catch (_) {}
      }, 200);
    }
    injectTrigger();
    const obs = new MutationObserver((mutations) => {
      // Skip if all mutations are on our own button(s)
      for (const m of mutations) {
        const t = m.target;
        if (t && t.id === 'celeste-trigger-btn') continue;
        if (t && t.id === 'celeste-stage-btn')   continue;
        if (t && t.closest && (t.closest('#celeste-trigger-btn') || t.closest('#celeste-stage-btn'))) continue;
        schedule();
        return;
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  })();

  // Start watching for the request stage so the inline button stays in sync
  watchStage();
})();
