// ── Configuration ─────────────────────────────────────────────────────
const API_URL = 'https://redbull-faster-leaderboard.redbull-faster.workers.dev/leaderboard';
const REFRESH_INTERVAL = 60;
const PAGE_SIZE = 100;
const STAGE_STORAGE_KEY = 'rbf-stage';

// ── DOM refs ──────────────────────────────────────────────────────────
const $loading = document.getElementById('loading');
const $error = document.getElementById('error');
const $table = document.getElementById('leaderboard');
const $tbody = document.getElementById('leaderboardBody');
const $headRow = document.getElementById('leaderboardHead');
const $lastUpdated = document.getElementById('lastUpdated');
const $playerCount = document.getElementById('playerCount');
const $refreshDot = document.getElementById('refreshDot');
const $rankHeader = document.getElementById('rankHeader');
const $totalHeader = document.getElementById('totalHeader');
const $searchInput = document.getElementById('searchInput');
const $loadMoreWrap = document.getElementById('loadMoreWrap');
const $loadMoreBtn = document.getElementById('loadMoreBtn');
const $loadMoreInfo = document.getElementById('loadMoreInfo');
const $stageToggle = document.getElementById('stageToggle');

let currentData = null;
let sortedData = null;
let visibleCount = PAGE_SIZE;
let sortMode = 'total'; // 'total' or `map${index}`
let currentStage = 'all'; // 'all' | '1' | '2' | '3'
let mapHeaderEls = [];

try {
  const stored = localStorage.getItem(STAGE_STORAGE_KEY);
  if (stored === 'all' || stored === '1' || stored === '2' || stored === '3') currentStage = stored;
} catch {}

// ── Expand short API keys ─────────────────────────────────────────────
function expandEntry(e) {
  return {
    rank: e.r, rank1: e.r1, rank2: e.r2, rank3: e.r3,
    name: e.n, flag: e.f,
    ts: e.ts || [], rs: e.rs || [],
    sum: e.s, sum1: e.s1, sum2: e.s2, sum3: e.s3,
    mc: e.mc, mc1: e.mc1, mc2: e.mc2, mc3: e.mc3,
    li: e.li,
  };
}

// ── Per-stage field resolution ────────────────────────────────────────
function stageFields() {
  if (currentStage === '1') return { sum: 'sum1', mc: 'mc1', rank: 'rank1' };
  if (currentStage === '2') return { sum: 'sum2', mc: 'mc2', rank: 'rank2' };
  if (currentStage === '3') return { sum: 'sum3', mc: 'mc3', rank: 'rank3' };
  return { sum: 'sum', mc: 'mc', rank: 'rank' };
}

function activeNumMaps() {
  if (!currentData) return 0;
  if (currentStage === 'all') return currentData.mapNames.length;
  const stage = parseInt(currentStage, 10);
  return currentData.mapStages.filter(s => s === stage).length;
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
  return `<img class="player-flag" src="https://flagcdn.com/${iso}.svg" alt="${iso}" loading="lazy" onerror="this.style.display='none'">`;
}

// ── Map header management ─────────────────────────────────────────────
function buildMapHeaders() {
  mapHeaderEls.forEach(el => el.remove());
  mapHeaderEls = [];
  if (!currentData) return;

  const { mapNames, mapStages } = currentData;
  for (let i = 0; i < mapNames.length; i++) {
    const th = document.createElement('th');
    th.className = 'col-time sortable';
    th.dataset.mapIdx = String(i);
    th.dataset.stage = String(mapStages[i] ?? '');
    th.innerHTML = `<span>${escapeHtml(mapNames[i] || `Map ${i + 1}`)}</span> <span class="sort-arrow"></span>`;
    const idx = i;
    th.addEventListener('click', () => {
      const mode = `map${idx}`;
      setSort(sortMode === mode ? 'total' : mode);
    });
    $headRow.insertBefore(th, $totalHeader);
    mapHeaderEls.push(th);
  }
}

// ── Sorting ───────────────────────────────────────────────────────────
function getSortedData() {
  if (!currentData) return [];
  const list = [...currentData.entries];

  if (sortMode === 'total') {
    const { sum, mc } = stageFields();
    list.sort((a, b) => {
      if (a[mc] !== b[mc]) return b[mc] - a[mc];
      return a[sum] - b[sum];
    });
  } else if (sortMode.startsWith('map')) {
    const idx = parseInt(sortMode.slice(3), 10);
    list.sort((a, b) => {
      const av = a.ts[idx];
      const bv = b.ts[idx];
      const aHas = av !== null && av !== undefined;
      const bHas = bv !== null && bv !== undefined;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      if (aHas && bHas) return av - bv;
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
  mapHeaderEls.forEach(h => h.classList.remove('sort-active'));
  $totalHeader.classList.remove('sort-active');

  if (sortMode.startsWith('map')) {
    const idx = parseInt(sortMode.slice(3), 10);
    if (mapHeaderEls[idx]) mapHeaderEls[idx].classList.add('sort-active');
    else $totalHeader.classList.add('sort-active');
  } else {
    $totalHeader.classList.add('sort-active');
  }
}

// ── Stage filter ──────────────────────────────────────────────────────
function applyStageClass() {
  $table.classList.remove('filter-stage-1', 'filter-stage-2', 'filter-stage-3');
  if (currentStage === '1') $table.classList.add('filter-stage-1');
  else if (currentStage === '2') $table.classList.add('filter-stage-2');
  else if (currentStage === '3') $table.classList.add('filter-stage-3');
}

function setStage(stage) {
  currentStage = stage;
  try { localStorage.setItem(STAGE_STORAGE_KEY, stage); } catch {}

  $stageToggle.querySelectorAll('.stage-btn').forEach(b => {
    const active = b.dataset.stage === stage;
    b.classList.toggle('stage-active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  applyStageClass();

  // If sorting by a map that is now hidden, fall back to total
  if (sortMode.startsWith('map') && currentData) {
    const idx = parseInt(sortMode.slice(3), 10);
    const mapStage = String(currentData.mapStages[idx] ?? '');
    if (stage !== 'all' && stage !== mapStage) {
      setSort('total');
      return;
    }
  }

  // Re-sort and re-render: Total column and ranks are stage-specific
  if (currentData) {
    visibleCount = PAGE_SIZE;
    sortedData = getSortedData();
    if ($searchInput.value.trim()) applySearch();
    else renderVisible();
  }
}

$stageToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.stage-btn');
  if (!btn) return;
  setStage(btn.dataset.stage);
});

// ── Build a single row ────────────────────────────────────────────────
function buildRow(e, bestTime, numMaps, mapStages, fields, stageMapCount) {
  const tr = document.createElement('tr');
  tr.dataset.playerName = (e.name || '').toLowerCase();

  const dr = e[fields.rank];

  if (dr === 1) tr.className = 'top-1';
  else if (dr === 2) tr.className = 'top-2';
  else if (dr === 3) tr.className = 'top-3';

  const rankClass = dr <= 3 ? `rank-${dr}` : '';
  const flag = flagImg(e.flag);

  let mapCellsHtml = '';
  for (let i = 0; i < numMaps; i++) {
    const t = e.ts[i];
    const r = e.rs[i];
    const ft = formatTime(t);
    const mr = r != null ? `<span class="map-rank">(${r})</span>` : '';
    const missing = ft === null ? 'time-missing' : '';
    const stage = mapStages[i] ?? '';
    mapCellsHtml += `<td class="col-time ${missing}" data-stage="${stage}">${ft !== null ? mr + ft : '—'}</td>`;
  }

  const sum = e[fields.sum];
  const mc = e[fields.mc];
  const total = formatTime(sum);
  let deltaHtml = '';
  if (sortMode === 'total' && dr > 1 && bestTime > 0 && mc === stageMapCount) {
    const d = formatDelta(sum - bestTime);
    if (d) deltaHtml = `<span class="delta">(${d})</span>`;
  }

  const li = timeAgo(e.li);

  tr.innerHTML = `
    <td class="col-rank ${rankClass}">${dr}</td>
    <td class="col-player">${flag}${escapeHtml(e.name)}</td>
    ${mapCellsHtml}
    <td class="col-total">${total ?? '—'}${deltaHtml ? '<br>' + deltaHtml : ''}</td>
    <td class="col-improved">${li}</td>
  `;
  return tr;
}

// ── Rendering ─────────────────────────────────────────────────────────
function renderLeaderboard(data) {
  currentData = {
    entries: data.l.map(expandEntry),
    mapNames: data.mn || [],
    mapStages: data.st || [],
    lastUpdated: data.lu,
    totalPlayers: data.tp,
  };

  buildMapHeaders();
  applyStageClass();

  // If loaded stage was for a map that doesn't exist, reset sort
  if (sortMode.startsWith('map')) {
    const idx = parseInt(sortMode.slice(3), 10);
    if (idx >= currentData.mapNames.length) sortMode = 'total';
  }

  $playerCount.textContent = currentData.totalPlayers;
  dataTimestamp = currentData.lastUpdated ? new Date(currentData.lastUpdated).getTime() : Date.now();
  updateTimerDisplay();

  sortedData = getSortedData();
  updateHeaderStyles();

  $loading.style.display = 'none';
  $error.style.display = 'none';
  $table.style.display = 'table';

  if ($searchInput.value.trim()) {
    applySearch();
  } else {
    renderVisible();
  }
}

function getBestTime() {
  if (!currentData) return 0;
  const f = stageFields();
  const n = activeNumMaps();
  const best = currentData.entries.find(e => e[f.rank] === 1 && e[f.mc] === n);
  return best ? best[f.sum] : 0;
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
  if (!sortedData || !currentData) return;
  const bestTime = getBestTime();
  const numMaps = currentData.mapNames.length;
  const stages = currentData.mapStages;
  const fields = stageFields();
  const stageMapCount = activeNumMaps();
  const start = visibleCount;
  visibleCount += PAGE_SIZE;
  const end = Math.min(visibleCount, sortedData.length);

  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    fragment.appendChild(buildRow(sortedData[i], bestTime, numMaps, stages, fields, stageMapCount));
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

  if (query && sortedData && currentData) {
    if (query.length < 2) {
      $tbody.innerHTML = '';
      $loadMoreWrap.style.display = 'none';
      return;
    }

    const bestTime = getBestTime();
    const numMaps = currentData.mapNames.length;
    const stages = currentData.mapStages;
    const fields = stageFields();
    const stageMapCount = activeNumMaps();
    const fragment = document.createDocumentFragment();
    let count = 0;

    for (const entry of sortedData) {
      if (count >= SEARCH_MAX_RESULTS) break;
      if ((entry.name || '').toLowerCase().includes(query)) {
        fragment.appendChild(buildRow(entry, bestTime, numMaps, stages, fields, stageMapCount));
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
  if (!sortedData || !currentData) return;
  const bestTime = getBestTime();
  const numMaps = currentData.mapNames.length;
  const stages = currentData.mapStages;
  const fields = stageFields();
  const stageMapCount = activeNumMaps();
  const limit = Math.min(visibleCount, sortedData.length);
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < limit; i++) {
    fragment.appendChild(buildRow(sortedData[i], bestTime, numMaps, stages, fields, stageMapCount));
  }

  $tbody.innerHTML = '';
  $tbody.appendChild(fragment);
  updateLoadMore();
}

$searchInput.addEventListener('input', debouncedSearch);

// ── Total header handler ──────────────────────────────────────────────
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

// ── Auto-refresh & updated ticker ────────────────────────────────────
let dataTimestamp = null;
let refreshTimer = null;
let tickTimer = null;

function updateTimerDisplay() {
  if (dataTimestamp) {
    const secs = Math.floor((Date.now() - dataTimestamp) / 1000);
    $lastUpdated.textContent = `${secs}s ago`;
  }
}

function startRefreshCycle() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    clearInterval(refreshTimer);
    await fetchLeaderboard();
    startRefreshCycle();
  }, REFRESH_INTERVAL * 1000);
}

function startUpdatedTicker() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(updateTimerDisplay, 1000);
}

// ── Init ──────────────────────────────────────────────────────────────
setStage(currentStage);

fetchLeaderboard().then(() => {
  startRefreshCycle();
  startUpdatedTicker();
});
