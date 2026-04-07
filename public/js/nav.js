/* ============================================================
   DONBEOLJA Navigation — Sidebar toggle + Exchange switch
   ============================================================ */

(function () {
  'use strict';

  /* ── Mobile sidebar toggle ───────────────────────────── */
  const menuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  function openSidebar() {
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.style.display = 'block';
  }

  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.style.display = 'none';
  }

  if (menuBtn) menuBtn.addEventListener('click', openSidebar);
  if (overlay) overlay.addEventListener('click', closeSidebar);

  /* ── Exchange mode switcher ──────────────────────────── */
  var KEY = 'db_exchange_mode';
  var sel = document.getElementById('exchange-select');
  var hint = document.getElementById('exchange-hint');
  if (!sel) return;

  function norm(raw) {
    var v = String(raw || '').toUpperCase();
    if (v.includes('BINANCE')) return 'BINANCEFUT';
    return 'BINANCEFUT';
  }

  function label(p) {
    return '바이낸스 선물';
  }

  function hintText(p, multi) {
    return multi ? '선물 · 멀티 실행' : '선물 · 멀티 마켓';
  }

  function renderOptions(providers) {
    var fallback = ['BINANCEFUT'];
    var list = Array.isArray(providers) && providers.length ? providers : fallback;
    var seen = {};
    sel.innerHTML = '';
    for (var i = 0; i < list.length; i++) {
      var n = norm(list[i]);
      if (seen[n]) continue;
      seen[n] = true;
      var opt = document.createElement('option');
      opt.value = n;
      opt.textContent = label(n);
      sel.appendChild(opt);
    }
  }

  function cur() {
    return norm(sel.value || (sel.options[0] && sel.options[0].value) || 'BINANCEFUT');
  }

  function updateLinks(provider) {
    var v = norm(provider);
    var links = document.querySelectorAll('.sidebar-nav a[href^="/dashboard"]');
    links.forEach(function (a) {
      try {
        var url = new URL(a.getAttribute('href'), window.location.origin);
        url.searchParams.set('exchange', v);
        a.setAttribute('href', url.pathname + url.search);
      } catch (_) {}
    });
  }

  var _multi = false;

  function apply(val) {
    var v = norm(val);
    var found = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (String(sel.options[i].value).toUpperCase() === v) { found = true; break; }
    }
    var resolved = found ? v : (sel.options[0] ? norm(sel.options[0].value) : 'BINANCEFUT');
    sel.value = resolved;
    if (hint) hint.textContent = hintText(resolved, _multi);
    try { localStorage.setItem(KEY, resolved); } catch (_) {}
    try { document.cookie = 'db_exchange_mode=' + encodeURIComponent(resolved) + '; path=/; max-age=31536000'; } catch (_) {}
    updateLinks(resolved);
  }

  async function loadServer() {
    try {
      var r = await fetch('/api/settings/exchanges', { credentials: 'include' });
      var t = await r.text();
      var j = JSON.parse(t);
      if (!r.ok || !j || !j.ok) return null;
      return {
        provider: (j.data && j.data.provider) ? norm(j.data.provider) : null,
        locked: !!(j.data && j.data.locked_by_env),
        multi: !!(j.data && j.data.multi_enabled),
        available: Array.isArray(j.data && j.data.available_providers)
          ? j.data.available_providers.map(norm) : [],
      };
    } catch (_) { return null; }
  }

  async function saveServer(provider) {
    try {
      var resp = await fetch('/api/settings/exchanges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: norm(provider), set_active_only: true }),
      });
      return !!(resp && resp.ok);
    } catch (_) { return false; }
  }

  (async function init() {
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (_) {}
    var info = await loadServer();
    renderOptions(info && info.available ? info.available : []);
    _multi = !!(info && info.multi);
    apply((info && info.provider) ? info.provider : (saved || cur()));
    if (info && info.locked) sel.disabled = true;
  })();

  sel.addEventListener('change', async function () {
    var next = cur();
    var ok = await saveServer(next);
    if (!ok) return;
    apply(next);
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('exchange', next);
      window.location.href = url.pathname + url.search;
    } catch (_) {}
  });
})();
