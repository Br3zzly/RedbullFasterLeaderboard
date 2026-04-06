// ── Configuration ─────────────────────────────────────────────────────
const API_URL = 'https://redbull-faster-leaderboard.redbull-faster.workers.dev/leaderboard';
const REFRESH_INTERVAL = 60;
const PAGE_SIZE = 100;

// ── DOM refs ──────────────────────────────────────────────────────────
const $loading = document.getElementById('loading');
const $error = document.getElementById('error');
const $table = document.getElementById('leaderboard');
const $tbody = document.getElementById('leaderboardBody');
const $countdown = document.getElementById('countdown');
const $lastUpdated = document.getElementById('lastUpdated');
const $playerCount = document.getElementById('playerCount');
const $refreshDot = document.getElementById('refreshDot');
const $mapHeader1 = document.getElementById('mapHeader1');
const $mapHeader2 = document.getElementById('mapHeader2');
const $mapHeader3 = document.getElementById('mapHeader3');
const $rankHeader = document.getElementById('rankHeader');
const $totalHeader = document.getElementById('totalHeader');
const $searchInput = document.getElementById('searchInput');
const $loadMoreWrap = document.getElementById('loadMoreWrap');
const $loadMoreBtn = document.getElementById('loadMoreBtn');
const $loadMoreInfo = document.getElementById('loadMoreInfo');

let countdownTimer = null;
let secondsLeft = REFRESH_INTERVAL;
let currentData = null;
let sortedData = null;
let visibleCount = PAGE_SIZE;
let sortMode = 'total';
let mapNames = ['Map 1', 'Map 2', 'Map 3'];

// ── Expand short API keys to readable names (once on receive) ─────────
function expandEntry(e) {
  return {
    rank: e.r, name: e.n, flag: e.f,
    t1: e.t1, r1: e.r1,
    t2: e.t2, r2: e.r2,
    t3: e.t3, r3: e.r3,
    sum: e.s, mc: e.mc, li: e.li,
  };
}

// ── Time formatting ───────────────────────────────────────────────────
function formatTime(ms) {
  if (ms === null || ms === undefined) return null;
  const totalMs = Math.abs(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function formatDelta(deltaMs) {
  if (!deltaMs || deltaMs <= 0) return '';
  return `+${formatTime(deltaMs)}`;
}

function timeAgo(isoOrTimestamp) {
  if (!isoOrTimestamp) return '—';
  const date = typeof isoOrTimestamp === 'number'
    ? new Date(isoOrTimestamp * 1000)
    : new Date(isoOrTimestamp);
  const diff = Date.now() - date.getTime();
  if (diff < 0) return 'just now';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function flagImg(iso) {
  if (!iso) return '';
  return `<img class="player-flag" src="https://flagcdn.com/16x12/${iso}.png" alt="${iso}" loading="lazy" onerror="this.style.display='none'">`;
}

// ── Sorting ───────────────────────────────────────────────────────────
function getSortedData() {
  if (!currentData) return [];
  const list = [...currentData.entries];

  if (sortMode === 'total') {
    list.sort((a, b) => {
      if (a.mc !== b.mc) return b.mc - a.mc;
      return a.sum - b.sum;
    });
  } else {
    const key = sortMode === 'map1' ? 't1' : sortMode === 'map2' ? 't2' : 't3';
    list.sort((a, b) => {
      const aHas = a[key] !== null;
      const bHas = b[key] !== null;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      if (aHas && bHas) return a[key] - b[key];
      return 0;
    });
  }

  for (let i = 0; i < list.length; i++) {
    list[i]._dr = i + 1;
  }

  return list;
}

function setSort(mode) {
  sortMode = mode;
  visibleCount = PAGE_SIZE;
  updateHeaderStyles();
  sortedData = getSortedData();
  renderVisible();
}

function updateHeaderStyles() {
  [$mapHeader1, $mapHeader2, $mapHeader3, $totalHeader].forEach(h => h.classList.remove('sort-active'));

  if (sortMode === 'map1') {
    $mapHeader1.classList.add('sort-active');
    $rankHeader.textContent = mapNames[0] + ' #';
  } else if (sortMode === 'map2') {
    $mapHeader2.classList.add('sort-active');
    $rankHeader.textContent = mapNames[1] + ' #';
  } else if (sortMode === 'map3') {
    $mapHeader3.classList.add('sort-active');
    $rankHeader.textContent = mapNames[2] + ' #';
  } else {
    $totalHeader.classList.add('sort-active');
    $rankHeader.textContent = '#';
  }
}

// ── Build a single row ────────────────────────────────────────────────
function buildRow(e, bestTime) {
  const tr = document.createElement('tr');
  tr.dataset.playerName = (e.name || '').toLowerCase();

  const dr = e._dr ?? e.rank;

  if (dr === 1) tr.className = 'top-1';
  else if (dr === 2) tr.className = 'top-2';
  else if (dr === 3) tr.className = 'top-3';

  const rankClass = dr <= 3 ? `rank-${dr}` : '';
  const flag = flagImg(e.flag);

  const ft1 = formatTime(e.t1);
  const ft2 = formatTime(e.t2);
  const ft3 = formatTime(e.t3);
  const total = formatTime(e.sum);

  const mr1 = e.r1 != null ? `<span class="map-rank">(${e.r1})</span>` : '';
  const mr2 = e.r2 != null ? `<span class="map-rank">(${e.r2})</span>` : '';
  const mr3 = e.r3 != null ? `<span class="map-rank">(${e.r3})</span>` : '';

  let deltaHtml = '';
  if (sortMode === 'total' && dr > 1 && bestTime > 0 && e.mc === 3) {
    const d = formatDelta(e.sum - bestTime);
    if (d) deltaHtml = `<span class="delta">(${d})</span> `;
  }

  const li = timeAgo(e.li);

  tr.innerHTML = `
    <td class="col-rank ${rankClass}">${dr}</td>
    <td class="col-player">${flag}${escapeHtml(e.name)}</td>
    <td class="col-time ${ft1 === null ? 'time-missing' : ''}">${ft1 !== null ? mr1 + ft1 : '—'}</td>
    <td class="col-time ${ft2 === null ? 'time-missing' : ''}">${ft2 !== null ? mr2 + ft2 : '—'}</td>
    <td class="col-time ${ft3 === null ? 'time-missing' : ''}">${ft3 !== null ? mr3 + ft3 : '—'}</td>
    <td class="col-total">${total ?? '—'}${deltaHtml ? '<br>' + deltaHtml : ''}</td>
    <td class="col-improved">${li}</td>
  `;
  return tr;
}

// ── Rendering ─────────────────────────────────────────────────────────
function renderLeaderboard(data) {
  // Expand short keys once
  currentData = {
    entries: data.l.map(expandEntry),
    mapNames: data.mn,
    lastUpdated: data.lu,
    totalPlayers: data.tp,
  };

  if (currentData.mapNames) {
    mapNames = currentData.mapNames;
    $mapHeader1.childNodes[0].textContent = mapNames[0] || 'Map 1';
    $mapHeader2.childNodes[0].textContent = mapNames[1] || 'Map 2';
    $mapHeader3.childNodes[0].textContent = mapNames[2] || 'Map 3';
  }

  $playerCount.textContent = currentData.totalPlayers;
  $lastUpdated.textContent = currentData.lastUpdated ? timeAgo(currentData.lastUpdated) : '—';

  sortedData = getSortedData();
  updateHeaderStyles();

  $loading.style.display = 'none';
  $error.style.display = 'none';
  $table.style.display = 'table';

  renderVisible();
}

function getBestTime() {
  if (!currentData) return 0;
  const best = currentData.entries.find(e => e.mc === 3);
  return best ? best.sum : 0;
}

function updateLoadMore() {
  if (!sortedData) return;
  const query = $searchInput.value.trim();
  const total = sortedData.length;

  if (query || visibleCount >= total) {
    $loadMoreWrap.style.display = 'none';
  } else {
    $loadMoreWrap.style.display = '';
    $loadMoreInfo.textContent = `Showing ${Math.min(visibleCount, total)} of ${total}`;
  }
}

function loadMore() {
  if (!sortedData) return;
  const bestTime = getBestTime();
  const start = visibleCount;
  visibleCount += PAGE_SIZE;
  const end = Math.min(visibleCount, sortedData.length);

  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    fragment.appendChild(buildRow(sortedData[i], bestTime));
  }
  $tbody.appendChild(fragment);

  updateLoadMore();
}

$loadMoreBtn.addEventListener('click', loadMore);

function showError(message) {
  $loading.style.display = 'none';
  $error.style.display = 'block';
  $error.textContent = `Error: ${message}`;
  $table.style.display = 'none';
}

// ── Search ────────────────────────────────────────────────────────────
const SEARCH_MAX_RESULTS = 200;
let searchTimeout = null;

function applySearch() {
  const query = $searchInput.value.trim().toLowerCase();

  if (query && sortedData) {
    if (query.length < 2) {
      $tbody.innerHTML = '';
      $loadMoreWrap.style.display = 'none';
      return;
    }

    const bestTime = getBestTime();
    const fragment = document.createDocumentFragment();
    let count = 0;

    for (const entry of sortedData) {
      if (count >= SEARCH_MAX_RESULTS) break;
      if ((entry.name || '').toLowerCase().includes(query)) {
        fragment.appendChild(buildRow(entry, bestTime));
        count++;
      }
    }

    $tbody.innerHTML = '';
    $tbody.appendChild(fragment);
    $loadMoreWrap.style.display = 'none';
  } else if (sortedData) {
    renderVisible();
  }
}

function debouncedSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(applySearch, 150);
}

function renderVisible() {
  if (!sortedData) return;
  const bestTime = getBestTime();
  const limit = Math.min(visibleCount, sortedData.length);
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < limit; i++) {
    fragment.appendChild(buildRow(sortedData[i], bestTime));
  }

  $tbody.innerHTML = '';
  $tbody.appendChild(fragment);
  updateLoadMore();
}

$searchInput.addEventListener('input', debouncedSearch);

// ── Sort click handlers ───────────────────────────────────────────────
$mapHeader1.addEventListener('click', () => setSort(sortMode === 'map1' ? 'total' : 'map1'));
$mapHeader2.addEventListener('click', () => setSort(sortMode === 'map2' ? 'total' : 'map2'));
$mapHeader3.addEventListener('click', () => setSort(sortMode === 'map3' ? 'total' : 'map3'));
$totalHeader.addEventListener('click', () => setSort('total'));

// ── Data fetching ─────────────────────────────────────────────────────
async function fetchLeaderboard() {
  $refreshDot.classList.add('fetching');
  try {
    const res = await fetch(API_URL);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API returned ${res.status}: ${body}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderLeaderboard(data);
  } catch (err) {
    console.error('Fetch error:', err);
    if ($table.style.display === 'none') {
      showError(err.message);
    }
  } finally {
    $refreshDot.classList.remove('fetching');
  }
}

// ── Countdown & auto-refresh ──────────────────────────────────────────
function startCountdown() {
  secondsLeft = REFRESH_INTERVAL;
  $countdown.textContent = secondsLeft;

  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    secondsLeft--;
    $countdown.textContent = Math.max(0, secondsLeft);
    if (secondsLeft <= 0) {
      fetchLeaderboard();
      secondsLeft = REFRESH_INTERVAL;
    }
  }, 1000);
}

// ── Init ──────────────────────────────────────────────────────────────
fetchLeaderboard().then(startCountdown);
