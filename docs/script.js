// ── Configuration ─────────────────────────────────────────────────────
const API_URL = 'https://redbull-faster-leaderboard.redbull-faster.workers.dev/leaderboard';
const REFRESH_INTERVAL = 60;
const PAGE_SIZE = 100; // rows shown initially and per "Load More"

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
const $searchInput = document.getElementById('searchInput');
const $loadMoreWrap = document.getElementById('loadMoreWrap');
const $loadMoreBtn = document.getElementById('loadMoreBtn');
const $loadMoreInfo = document.getElementById('loadMoreInfo');

let countdownTimer = null;
let secondsLeft = REFRESH_INTERVAL;
let currentData = null;
let visibleCount = PAGE_SIZE;

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

// ── Flag image ────────────────────────────────────────────────────────
function flagImg(iso) {
  if (!iso) return '';
  return `<img class="player-flag" src="https://flagcdn.com/16x12/${iso}.png" alt="${iso}" loading="lazy" onerror="this.style.display='none'">`;
}

// ── Build a single row ────────────────────────────────────────────────
function buildRow(entry, bestTime) {
  const tr = document.createElement('tr');
  tr.dataset.playerName = (entry.playerName || '').toLowerCase();

  if (entry.rank === 1) tr.className = 'top-1';
  else if (entry.rank === 2) tr.className = 'top-2';
  else if (entry.rank === 3) tr.className = 'top-3';

  const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : '';
  const flag = flagImg(entry.countryIso);

  const t1 = formatTime(entry.map1Time);
  const t2 = formatTime(entry.map2Time);
  const t3 = formatTime(entry.map3Time);
  const total = formatTime(entry.sumTime);

  const r1 = entry.map1Rank != null ? `<span class="map-rank">(${entry.map1Rank})</span>` : '';
  const r2 = entry.map2Rank != null ? `<span class="map-rank">(${entry.map2Rank})</span>` : '';
  const r3 = entry.map3Rank != null ? `<span class="map-rank">(${entry.map3Rank})</span>` : '';

  // Delta from 1st place
  let deltaHtml = '';
  if (entry.rank > 1 && bestTime > 0 && entry.mapCount === 3) {
    const d = formatDelta(entry.sumTime - bestTime);
    if (d) deltaHtml = `<span class="delta">(${d})</span> `;
  }

  const lastImproved = timeAgo(entry.lastImproved);

  tr.innerHTML = `
    <td class="col-rank ${rankClass}">${entry.rank}</td>
    <td class="col-player">${flag}${escapeHtml(entry.playerName)}</td>
    <td class="col-time ${t1 === null ? 'time-missing' : ''}">${t1 !== null ? r1 + t1 : '—'}</td>
    <td class="col-time ${t2 === null ? 'time-missing' : ''}">${t2 !== null ? r2 + t2 : '—'}</td>
    <td class="col-time ${t3 === null ? 'time-missing' : ''}">${t3 !== null ? r3 + t3 : '—'}</td>
    <td class="col-total">${deltaHtml}${total ?? '—'}</td>
    <td class="col-improved">${lastImproved}</td>
  `;
  return tr;
}

// ── Rendering ─────────────────────────────────────────────────────────
function renderLeaderboard(data) {
  currentData = data;

  if (data.mapNames) {
    $mapHeader1.textContent = data.mapNames[0] || 'Map 1';
    $mapHeader2.textContent = data.mapNames[1] || 'Map 2';
    $mapHeader3.textContent = data.mapNames[2] || 'Map 3';
  }

  $playerCount.textContent = data.totalPlayers ?? data.leaderboard.length;
  $lastUpdated.textContent = data.lastUpdated ? timeAgo(data.lastUpdated) : '—';

  // Best time (1st place, must have all 3 maps)
  const best = data.leaderboard.find(e => e.mapCount === 3);
  const bestTime = best ? best.sumTime : 0;

  const fragment = document.createDocumentFragment();
  const limit = $searchInput.value.trim() ? data.leaderboard.length : visibleCount;

  for (let i = 0; i < Math.min(limit, data.leaderboard.length); i++) {
    fragment.appendChild(buildRow(data.leaderboard[i], bestTime));
  }

  $tbody.innerHTML = '';
  $tbody.appendChild(fragment);

  $loading.style.display = 'none';
  $error.style.display = 'none';
  $table.style.display = 'table';

  updateLoadMore();
  applySearch();
}

function updateLoadMore() {
  if (!currentData) return;
  const query = $searchInput.value.trim();
  const total = currentData.leaderboard.length;

  if (query || visibleCount >= total) {
    $loadMoreWrap.style.display = 'none';
  } else {
    $loadMoreWrap.style.display = '';
    $loadMoreInfo.textContent = `Showing ${Math.min(visibleCount, total)} of ${total}`;
  }
}

function loadMore() {
  if (!currentData) return;
  const best = currentData.leaderboard.find(e => e.mapCount === 3);
  const bestTime = best ? best.sumTime : 0;
  const start = visibleCount;
  visibleCount += PAGE_SIZE;
  const end = Math.min(visibleCount, currentData.leaderboard.length);

  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    fragment.appendChild(buildRow(currentData.leaderboard[i], bestTime));
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
function applySearch() {
  const query = $searchInput.value.trim().toLowerCase();

  if (query && currentData) {
    // When searching, render ALL matching rows (not just visible page)
    const best = currentData.leaderboard.find(e => e.mapCount === 3);
    const bestTime = best ? best.sumTime : 0;
    const fragment = document.createDocumentFragment();

    for (const entry of currentData.leaderboard) {
      if ((entry.playerName || '').toLowerCase().includes(query)) {
        fragment.appendChild(buildRow(entry, bestTime));
      }
    }

    $tbody.innerHTML = '';
    $tbody.appendChild(fragment);
    $loadMoreWrap.style.display = 'none';
  } else if (currentData) {
    // No search query — re-render with pagination
    renderVisible();
  }
}

function renderVisible() {
  if (!currentData) return;
  const best = currentData.leaderboard.find(e => e.mapCount === 3);
  const bestTime = best ? best.sumTime : 0;
  const limit = Math.min(visibleCount, currentData.leaderboard.length);
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < limit; i++) {
    fragment.appendChild(buildRow(currentData.leaderboard[i], bestTime));
  }

  $tbody.innerHTML = '';
  $tbody.appendChild(fragment);
  updateLoadMore();
}

$searchInput.addEventListener('input', applySearch);

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
