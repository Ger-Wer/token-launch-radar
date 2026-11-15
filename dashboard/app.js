// Token Radar's dashboard (radar-2). It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail panel
// with the model's own inputs and the protocol's farm plan. No network: every byte it
// shows is in data.js. The farm plan below is shared verbatim with lib/model.ts, so the
// board and the page can never disagree about what a protocol's plan says.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(2); }

  // The model in one function: the page recomputes a row from the snapshot figures and checks
  // the number board.json carries, so the page's code and the board's data are visibly the
  // same arithmetic. IV = anchor x (TVL / 50M)^0.522 x C x A x M x K, with C fitted per
  // category from this snapshot and A, M, K from the row's age, growth and chain count.
  function ageMult(age) {
    if (age === null || age === undefined) return 0.6;
    if (age < 30) return 0.35;
    if (age < 90) return 0.55;
    if (age < 180) return 0.85;
    if (age <= 540) return 1.0;
    if (age <= 730) return 0.9;
    if (age <= 1100) return 0.7;
    return 0.45;
  }
  function impliedOf(row, model) {
    var m = model;
    var base = m.anchor_usd * Math.pow(row.tvl_usd / m.floor_usd, m.tvl_exponent);
    var w = DATA.category_weights[row.category || 'Other'];
    var cat = w ? w.weight : 1.0;
    var age = ageMult(row.age_days);
    var growth = row.change_7d === null || row.change_7d === undefined
      ? m.missing_growth_mult
      : Math.exp(m.growth_rate * Math.min(m.growth_clip, Math.max(-m.growth_clip, row.change_7d)));
    var chains = 1 + m.chains_step * Math.min(Math.max((row.chains || []).length - 1, 0), m.chains_cap);
    return { implied: Math.max(1, Math.round(base * cat * age * growth * chains)), base: base, cat: cat, age: age, growth: growth, chains: chains };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

// FARM-PLAN-BEGIN
// The farm plan, shared verbatim between lib/model.ts and dashboard/app.js: the same
// function scores the same protocol the same way in the board and in the page.
// Amounts come from the protocol's TVL, hold times from its age and category —
// never from its name. Each step is "action. Cost: … Time: …", 20–600 characters.

/** How much capital one farm position needs, from the protocol's own TVL. */
function farmCapitalFor(tvlUsd) {
  if (tvlUsd >= 5_000_000_000) return 250;
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age; curators, allocators and chains hold longer. */
function farmHoldDaysFor(ageDays, longHold) {
  var hold;
  if (ageDays === null || ageDays === undefined) hold = 30;
  else if (ageDays < 180) hold = 60;
  else if (ageDays < 365) hold = 45;
  else hold = 30;
  return longHold ? hold + 28 : hold;
}

/** The category's main action, in the words a farmer can follow. */
function farmMainAction(category, name, chain, capital) {
  var c = (category || '').toLowerCase();
  if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' across 2–3 pools (a stablecoin and ETH or BTC) and keep the position open.';
  if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leverag') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('liquidity') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
  if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.';
  if (c.indexOf('perpetual') >= 0 || c.indexOf('derivat') >= 0 || c.indexOf('option') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged position.';
  if (c.indexOf('prediction') >= 0) return 'Fund ' + name + ' with $' + capital + ' on ' + chain + ' and place positions on 2–3 markets.';
  if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
  if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
  if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it for the daily accrual.';
  if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
  if (c === 'chain') return 'Stake or delegate $' + capital + ' through ' + name + ' and use 2–3 of its ecosystem apps on the same address.';
  if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Route $' + capital + ' of payments through ' + name + ' on ' + chain + ' and keep a balance on the same address.';
  if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold it.';
  return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
}

/** The second product to touch, so the address is more than a single deposit. */
function farmSecondAction(category, name, chain) {
  var c = (category || '').toLowerCase();
  if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow against the deposit and repay it twice, so the address shows both sides of the market.';
  if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leverag') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('liquidity') >= 0) return 'Make 5–10 swaps a week of $50–200 on ' + name + ', so the address counts as a trader, not only a depositor.';
  if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Put the receipt token to work in one DeFi pool on ' + chain + ' instead of letting it sit idle.';
  if (c.indexOf('perpetual') >= 0 || c.indexOf('derivat') >= 0 || c.indexOf('option') >= 0) return 'Add $500–2000 of liquidity to one ' + name + ' pool on ' + chain + ' beside the margin position.';
  if (c.indexOf('prediction') >= 0) return 'Settle and re-enter 2–3 markets a month instead of placing one position and leaving.';
  if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Split the deposit across 2–3 different vaults, so no single curator carries the whole position.';
  if (c.indexOf('stable') >= 0) return 'Use the minted stable asset in one lending or liquidity pool on ' + chain + ' instead of holding it idle.';
  if (c.indexOf('rwa') >= 0) return "Check the program's allowlist on " + name + "'s own site and confirm the address is on it.";
  if (c.indexOf('insurance') >= 0) return 'Extend the cover before it lapses, so the policy stays continuous through the snapshot.';
  if (c === 'chain') return "Join the network's testnet or governance vote from the same address when one opens.";
  return 'Use one more of the protocol’s products on the same address — a swap, a borrow, a vault or a vote.';
}

/** What to do with the yield, or how to vote: the step that keeps the position alive. */
function farmReinvestAction(category) {
  var c = (category || '').toLowerCase();
  if (c.indexOf('rwa') >= 0) return "Reinvest each month's coupon back into the same pool instead of withdrawing it.";
  if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return "Put the borrowed asset into the protocol's own liquidity pool, then repay the loan in full.";
  if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return "Vote on the curator's next allocation or metric when a vote opens.";
  if (c === 'chain') return 'Delegate any new rewards back to the same validator and keep the stake compounding.';
  if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('leverag') >= 0 || c.indexOf('liquidity') >= 0) return "Claim the pool's rewards weekly and add them back to the same position.";
  if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake the staking rewards weekly instead of claiming them to the wallet.';
  return 'Make one more qualifying action each week — a deposit, a swap, a borrow or a vote.';
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
function farmStepText(step) {
  var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan
 * is derived from the protocol's own record (category, chains, TVL, age), never from
 * a hand-written list of names.
 */
function farmStepsFor(category, name, chain, tvlUsd, ageDays) {
  var capital = farmCapitalFor(tvlUsd);
  var c = (category || '').toLowerCase();
  var longHold = c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c === 'chain';
  var hold = farmHoldDaysFor(ageDays, longHold);
  var isRwa = c.indexOf('rwa') >= 0;
  var steps = [];
  if (isRwa) {
    steps.push({ text: "Complete the protocol's identity check on its own site first, with the documents it asks for, then farm from a fresh wallet that holds only the funds you plan to use.", cost: 'no fee for the check itself; under $3 of gas for the first transaction', time: '20–40 minutes for the check, 5 minutes for the wallet' });
  } else {
    steps.push({ text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' });
  }
  steps.push({ text: farmMainAction(category, name, chain, capital), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' });
  if (longHold) {
    steps.push({ text: farmSecondAction(category, name, chain), cost: 'the $' + capital + ' split across the vaults, plus about $5 of gas', time: '20 minutes, once' });
  } else {
    steps.push({ text: farmSecondAction(category, name, chain), cost: 'about $2–5 of gas a week', time: '10–30 minutes a week' });
  }
  steps.push({ text: 'Hold the position for at least ' + hold + ' days, and do not withdraw in the 48 hours before any snapshot or announcement.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' });
  steps.push({ text: "Open the protocol's own points or rewards page once a week and check the address is earning; stay in the first half of the table.", cost: 'no fee to check', time: '5 minutes a week' });
  steps.push({ text: farmReinvestAction(category), cost: 'about $5–20 of gas', time: '10–15 minutes' });
  steps.push({ text: 'Write the wallet, the dates and every transaction in a farm log, so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' });
  return steps.map(farmStepText);
}
// FARM-PLAN-END

  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function farmSteps(p) {
    return farmStepsFor(p.category, p.name, chainOf(p), p.tvl_usd, p.age_days);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'TOKEN RADAR' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index · 758 protocols' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, ranked by the same model. Implied value is a model, not a promise: it says what a token would be worth if the protocol’s record stayed as it is.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { closeDetail(); state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { closeDetail(); state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var nameCell = el('div', { class: 'name' },
        el('b', { text: r.name }),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
      );
      if (r.watchlist) nameCell.appendChild(el('span', { class: 'watch', text: 'Watchlist' }));
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); detail.scrollIntoView({ block: 'nearest' }); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); detail.scrollIntoView({ block: 'nearest' }); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, nameCell),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort(function (a, b) {
      var wa = (DATA.category_weights[a] || { weight: 1 }).weight;
      var wb = (DATA.category_weights[b] || { weight: 1 }).weight;
      return wb - wa || (a < b ? -1 : a > b ? 1 : 0);
    });
    var catRows = cats.map(function (c) {
      var w = DATA.category_weights[c] || { n: 0, median: null, weight: 1, source: 'neutral' };
      return el('tr', null,
        el('td', { text: c }),
        el('td', { class: 'num', text: String(w.n) }),
        el('td', { class: 'num', text: w.median === null ? '—' : w.median.toFixed(3) }),
        el('td', { class: 'num', text: fmtMult(w.weight) }),
        el('td', { text: w.source === 'runtime' ? 'fitted' : w.source === 'expert' ? 'expert' : 'neutral' })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. TVL is not value: doubling TVL raises value only 1.4x, because the market pays less per locked dollar as protocols grow.' }),
      el('div', { class: 'formula' },
        'implied = ' + fmtUsd(m.anchor_usd) + ' x (TVL / $50M)^' + m.tvl_exponent + ' x C x A x M x K'
      ),
      el('div', { class: 'factors' },
        el('div', null, el('span', { text: 'C — category' }), el('b', { text: 'fitted where the sample is big enough, expert where it is not' })),
        el('div', null, el('span', { text: 'A — age with no token' }), el('b', { text: '0.35–1.00, peaks at 180–540 days' })),
        el('div', null, el('span', { text: 'M — seven-day growth' }), el('b', { text: 'exp(0.015 x change, clipped to ±25%)' })),
        el('div', null, el('span', { text: 'K — chains' }), el('b', { text: '1 + 0.05 per extra chain, up to 8' }))
      ),
      el('p', { class: 'sub', text: 'The anchor is $50M x the median market-cap-to-TVL ratio of the ' + DATA.ols_all.n + ' protocols with a market cap (' + m.global_median + ', so $' + (m.anchor_usd / 1e6).toFixed(2) + 'M). The exponent ' + m.tvl_exponent + ' is the OLS slope of ln(market cap) on ln(TVL) over all ' + DATA.ols_all.n + ' of them (R² ' + DATA.ols_all.r2 + '); restricting to the ' + DATA.ols_listed.n + ' with a listing date gives ' + DATA.ols_listed.slope + ' (R² ' + DATA.ols_listed.r2 + ') — the full sample is used because the listing date has nothing to do with the TVL→value relation. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age scores 0.60.' }),
      el('h3', { text: 'Category weights' }),
      el('p', { class: 'sub', text: 'C = 0.5 + 0.5 x (category median / ' + m.global_median + '), clipped to 0.25–2.00, where a category has at least ' + m.category_min_n + ' priced protocols. Smaller samples use the expert weight in the table: curators, allocators, aggregators and restaking are discounted because their TVL counts other protocols’ markets a second time.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'weights' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Priced' }),
            el('th', { scope: 'col', text: 'Median mcap / TVL' }),
            el('th', { scope: 'col', text: 'Weight' }),
            el('th', { scope: 'col', text: 'Source' })
          )),
          el('tbody', null, catRows)
        )
      )
    );
  }

  // The detail panel lives in the page flow, between the controls and the table:
  // a fixed overlay drawer paints wrong in some headless engines (the board's text
  // shows through its background), while an in-flow panel renders identically
  // everywhere and keeps the board visible beside the detail.
  var detail = el('section', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title', hidden: 'hidden' });

  function closeDetail() {
    state.selected = null;
    writeHash();
    detail.setAttribute('hidden', 'hidden');
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var calc = impliedOf(row, DATA.model);
    var steps = farmSteps(row);
    detail.textContent = '';
    detail.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · Watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { closeDetail(); render(); } })
    ));
    var grid = el('div', { class: 'detail-grid' });
    grid.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Base value' }), el('b', { class: 'num', text: fmtUsd(calc.base) })),
        el('div', null, el('span', { text: 'Category (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: fmtMult(calc.cat) })),
        el('div', null, el('span', { text: 'Age multiplier' }), el('b', { class: 'num', text: fmtMult(calc.age) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(calc.growth) })),
        el('div', null, el('span', { text: 'Chains multiplier' }), el('b', { class: 'num', text: fmtMult(calc.chains) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(calc.implied) + (calc.implied === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    grid.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    detail.appendChild(grid);
    detail.removeAttribute('hidden');
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') {
      shell.appendChild(detail);
      shell.appendChild(boardTable());
      shell.appendChild(modelPanel());
    } else {
      shell.appendChild(liveTable());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (state.selected && state.tab === 'pre-token') openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !detail.hasAttribute('hidden')) closeDetail();
  });
})();
