// Token Launch Radar — dashboard logic. Reads window.RADAR (data.js),
// renders the board, the live-token tab, and one detail view per protocol.
// No network: every number comes from the snapshot-derived dataset.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:32px">data.js did not load.</p>'; return; }

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  function money(n) {
    if (n === null || n === undefined) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function age(d) {
    if (d === null || d === undefined) return '—';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return d + 'd';
  }
  function changeClass(v) { return v === null ? '' : v >= 0 ? 'up' : 'down'; }

  // ---- header facts -------------------------------------------------------
  var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var parts = R.as_of.split('-');
  document.querySelector('[data-fact="as_of"]').textContent = parts[2] + ' ' + months[+parts[1] - 1] + ' ' + parts[0];
  document.querySelector('[data-fact="watchlist"]').textContent = R.watchlist_size + ' protocols';
  document.querySelector('[data-fact="board"]').textContent = R.board_size + ' rows';
  document.querySelector('[data-fact="top"]').textContent = money(R.rows[0].implied_value_usd);
  document.querySelector('[data-fact="model"]').textContent = R.model_version;

  // ---- state --------------------------------------------------------------
  var state = { tab: 'pre', q: '', cat: '', sort: 'rank', watchOnly: false };
  var hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('tab') === 'live') state.tab = 'live';
  if (hash.get('cat')) state.cat = hash.get('cat');
  if (hash.get('q')) state.q = hash.get('q');
  if (hash.get('sort')) state.sort = hash.get('sort');
  if (hash.get('watch') === '1') state.watchOnly = true;

  // Whether a row is on the forty-protocol watchlist is a fact the model
  // stamps on each row; it cannot be recomputed from TVL alone, because
  // rankable protocols above the floor can sit outside the watchlist.
  var watchlist = {};
  R.rows.forEach(function (r) { if (r.watchlist) watchlist[r.slug] = true; });

  // ---- category filter ----------------------------------------------------
  var cats = {};
  R.rows.forEach(function (r) { cats[r.category] = (cats[r.category] || 0) + 1; });
  var catSel = $('cat');
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c + ' (' + cats[c] + ')';
    catSel.appendChild(o);
  });

  // ---- controls -----------------------------------------------------------
  var qEl = $('q'), sortEl = $('sort'), watchEl = $('watchonly');
  qEl.value = state.q; catSel.value = state.cat; sortEl.value = state.sort; watchEl.checked = state.watchOnly;
  function syncHash() {
    var h = new URLSearchParams();
    if (state.tab === 'live') h.set('tab', 'live');
    if (state.cat) h.set('cat', state.cat);
    if (state.q) h.set('q', state.q);
    if (state.sort !== 'rank') h.set('sort', state.sort);
    if (state.watchOnly) h.set('watch', '1');
    var s = h.toString();
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }
  qEl.addEventListener('input', function () { state.q = qEl.value.trim(); syncHash(); render(); });
  catSel.addEventListener('change', function () { state.cat = catSel.value; syncHash(); render(); });
  sortEl.addEventListener('change', function () { state.sort = sortEl.value; syncHash(); render(); });
  watchEl.addEventListener('change', function () { state.watchOnly = watchEl.checked; syncHash(); render(); });

  var tabPre = $('tab-pre'), tabLive = $('tab-live');
  function setTab(t) {
    state.tab = t;
    tabPre.setAttribute('aria-selected', t === 'pre' ? 'true' : 'false');
    tabLive.setAttribute('aria-selected', t === 'live' ? 'true' : 'false');
    $('controls').style.display = t === 'pre' ? '' : 'none';
    syncHash(); render();
  }
  tabPre.addEventListener('click', function () { setTab('pre'); });
  tabLive.addEventListener('click', function () { setTab('live'); });

  // ---- table --------------------------------------------------------------
  var headRow = document.querySelector('#table thead tr');
  var PRE_HEAD = ['Rank', 'Protocol', 'Category', 'TVL', '7d', 'Age', 'Multiple', 'Implied value'];
  var LIVE_HEAD = ['#', 'Protocol', 'Category', 'TVL', '7d', 'Age', 'Multiple', 'Market cap'];
  function setHead(labels) {
    headRow.innerHTML = labels.map(function (l, i) {
      return '<th scope="col"' + (i >= 3 ? ' class="num"' : '') + '>' + l + '</th>';
    }).join('');
  }
  function sortRows(rows) {
    var k = state.sort;
    var key = k === 'implied' ? function (r) { return r.implied_value_usd; }
      : k === 'tvl' ? function (r) { return r.tvl_usd; }
      : k === 'change' ? function (r) { return r.change_7d === null ? -Infinity : r.change_7d; }
      : k === 'age' ? function (r) { return r.age_days; }
      : function (r) { return -r.rank; };
    return rows.slice().sort(function (a, b) {
      var d = key(b) - key(a);
      return d !== 0 ? d : a.slug < b.slug ? -1 : 1;
    });
  }
  function render() {
    var tbody = $('rows');
    if (state.tab === 'live') {
      setHead(LIVE_HEAD);
      var live = R.live.slice().sort(function (a, b) { return b.mcap_usd - a.mcap_usd; });
      $('count').textContent = live.length + ' live-token protocols, by market cap. Market values only — never ranked against the pre-token board.';
      tbody.innerHTML = live.map(function (r, i) {
        return '<tr><td class="num">' + (i + 1) + '</td>'
          + '<td class="namecell">' + esc(r.name) + '<small>' + esc(r.slug) + '</small></td>'
          + '<td>' + esc(r.category) + '</td>'
          + '<td class="num">' + money(r.tvl_usd) + '</td>'
          + '<td class="num ' + changeClass(r.change_7d) + '">' + pct(r.change_7d) + '</td>'
          + '<td class="num">' + age(r.age_days) + '</td>'
          + '<td class="num">' + r.multiple.toFixed(2) + '</td>'
          + '<td class="num">' + money(r.mcap_usd) + '</td></tr>';
      }).join('');
      return;
    }
    setHead(PRE_HEAD);
    var rows = R.rows.filter(function (r) {
      if (state.watchOnly && !watchlist[r.slug]) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      }
      return true;
    });
    rows = sortRows(rows);
    var wl = rows.filter(function (r) { return watchlist[r.slug]; }).length;
    $('count').textContent = 'Showing ' + rows.length + ' of ' + R.rows.length + ' rows' + (state.watchOnly ? '' : ' · ' + wl + ' watchlist') + '. Click a protocol for its value breakdown and farm plan.';
    tbody.innerHTML = rows.map(function (r) {
      var tag = r.multiple_source === 'category'
        ? '<span class="tag cat">category</span>'
        : '<span class="tag glob">global</span>';
      return '<tr><td class="num">' + r.rank + '</td>'
        + '<td class="namecell"><button class="rowbtn" data-slug="' + esc(r.slug) + '">' + esc(r.name) + '</button><small>' + esc(r.slug) + (watchlist[r.slug] ? ' · watchlist' : '') + '</small></td>'
        + '<td>' + esc(r.category) + '</td>'
        + '<td class="num">' + money(r.tvl_usd) + '</td>'
        + '<td class="num ' + changeClass(r.change_7d) + '">' + pct(r.change_7d) + '</td>'
        + '<td class="num">' + age(r.age_days) + '</td>'
        + '<td class="num">' + r.multiple.toFixed(4) + tag + '</td>'
        + '<td class="num">' + money(r.implied_value_usd) + '</td></tr>';
    }).join('');
    tbody.querySelectorAll('.rowbtn').forEach(function (b) {
      b.addEventListener('click', function () { openDetail(b.getAttribute('data-slug')); });
    });
  }

  // ---- detail view ----------------------------------------------------------
  var dialog = $('detail');
  function openDetail(slug) {
    var r = null;
    R.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    var chains = r.chains.length > 3
      ? r.chains.slice(0, 3).join(', ') + ' +' + (r.chains.length - 3) + ' more'
      : r.chains.join(', ');
    var src = r.multiple_source === 'category'
      ? 'category median — ' + esc(r.category) + ' has at least 5 traded protocols'
      : 'global median — ' + esc(r.category) + ' has fewer than 5 traded protocols';
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('detail-body').innerHTML = '<div class="detail">'
      + '<h3 id="detail-title">' + esc(r.name) + '</h3>'
      + '<p class="sub">Rank ' + r.rank + ' · ' + esc(r.category) + ' · ' + esc(chains) + ' · ' + (watchlist[r.slug] ? 'on the watchlist' : 'below the watchlist floor') + '</p>'
      + '<h4>How the value is worked out</h4>'
      + '<table class="calc"><tbody>'
      + '<tr><td>TVL</td><td>' + money(r.tvl_usd) + '</td></tr>'
      + '<tr><td>Multiple (' + src + ')</td><td>× ' + r.multiple.toFixed(4) + '</td></tr>'
      + '<tr><td>Growth multiplier (7d ' + pct(r.change_7d) + ')</td><td>× ' + r.growth_multiplier.toFixed(4) + '</td></tr>'
      + '<tr><td>Maturity multiplier (' + age(r.age_days) + ' old)</td><td>× ' + r.maturity_multiplier.toFixed(4) + '</td></tr>'
      + '<tr class="total"><td>Implied value</td><td>' + money(r.implied_value_usd) + '</td></tr>'
      + '</tbody></table>'
      + '<h4>Farm plan — seven steps</h4><ol>' + steps + '</ol>'
      + '<p class="caveat">This implied value is what a token would be worth if one were issued at the market’s usual ratio for its category. It is not a prediction that a token will be issued, or when. Claim only from links the protocol itself publishes, and never pay a fee to claim.</p>'
      + '</div>';
    dialog.showModal();
  }
  $('detail-close').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });

  setTab(state.tab);
  if (hash.get('detail')) openDetail(hash.get('detail'));
})();
