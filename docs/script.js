// ── Configuration ─────────────────────────────────────────────────────
const API_URL = 'https://redbull-faster-leaderboard.redbull-faster.workers.dev/leaderboard';
const REFRESH_INTERVAL = 60; // seconds

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

let countdownTimer = null;
let secondsLeft = REFRESH_INTERVAL;
let currentData = null;

// ── Time formatting ───────────────────────────────────────────────────
function formatTime(ms) {
  if (ms === null || ms === undefined) return null;
  const totalMs = Math.abs(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function timeAgo(isoOrTimestamp) {
  if (!isoOrTimestamp) return '—';
  // Handle both ISO strings and unix timestamps (seconds)
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

// ── Rendering ─────────────────────────────────────────────────────────
function renderLeaderboard(data) {
  currentData = data;

  if (data.mapNames) {
    $mapHeader1.textContent = data.mapNames[0] || 'Map 1';
    $mapHeader2.textContent = data.mapNames[1] || 'Map 2';
    $mapHeader3.textContent = data.mapNames[2] || 'Map 3';
  }

  $playerCount.textContent = data.rankedPlayers ?? data.leaderboard.length;
  $lastUpdated.textContent = data.lastUpdated ? timeAgo(data.lastUpdated) : '—';

  const fragment = document.createDocumentFragment();
  let addedSeparator = false;

  for (const entry of data.leaderboard) {
    if (entry.rank === null && !addedSeparator) {
      addedSeparator = true;
      const sepRow = document.createElement('tr');
      sepRow.className = 'separator-row';
      sepRow.innerHTML = `<td colspan="7">Incomplete — missing map times</td>`;
      fragment.appendChild(sepRow);
    }

    const tr = document.createElement('tr');
    tr.dataset.playerName = (entry.playerName || '').toLowerCase();

    if (entry.rank === 1) tr.className = 'top-1';
    else if (entry.rank === 2) tr.className = 'top-2';
    else if (entry.rank === 3) tr.className = 'top-3';

    const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : (entry.rank === null ? 'rank-unranked' : '');
    const rankText = entry.rank !== null ? entry.rank : '—';

    const flag = entry.countryFlag ? `<span class="player-flag">${entry.countryFlag}</span>` : '';

    const t1 = formatTime(entry.map1Time);
    const t2 = formatTime(entry.map2Time);
    const t3 = formatTime(entry.map3Time);
    const total = formatTime(entry.totalTime);

    const r1 = entry.map1Rank != null ? `<span class="map-rank">(${entry.map1Rank})</span>` : '';
    const r2 = entry.map2Rank != null ? `<span class="map-rank">(${entry.map2Rank})</span>` : '';
    const r3 = entry.map3Rank != null ? `<span class="map-rank">(${entry.map3Rank})</span>` : '';

    const lastImproved = timeAgo(entry.lastImproved);

    tr.innerHTML = `
      <td class="col-rank ${rankClass}">${rankText}</td>
      <td class="col-player">${flag}${escapeHtml(entry.playerName)}</td>
      <td class="col-time ${t1 === null ? 'time-missing' : ''}">${t1 !== null ? r1 + t1 : '—'}</td>
      <td class="col-time ${t2 === null ? 'time-missing' : ''}">${t2 !== null ? r2 + t2 : '—'}</td>
      <td class="col-time ${t3 === null ? 'time-missing' : ''}">${t3 !== null ? r3 + t3 : '—'}</td>
      <td class="col-total ${total === null ? 'total-incomplete' : ''}">${total ?? '—'}</td>
      <td class="col-improved">${lastImproved}</td>
    `;
    fragment.appendChild(tr);
  }

  $tbody.innerHTML = '';
  $tbody.appendChild(fragment);

  $loading.style.display = 'none';
  $error.style.display = 'none';
  $table.style.display = 'table';

  // Re-apply search filter
  applySearch();
}

function showError(message) {
  $loading.style.display = 'none';
  $error.style.display = 'block';
  $error.textContent = `Error: ${message}`;
  $table.style.display = 'none';
}

// ── Search ────────────────────────────────────────────────────────────
function applySearch() {
  const query = $searchInput.value.trim().toLowerCase();
  const rows = $tbody.querySelectorAll('tr');
  for (const row of rows) {
    if (row.classList.contains('separator-row')) {
      row.style.display = query ? 'none' : '';
      continue;
    }
    const name = row.dataset.playerName || '';
    if (!query || name.includes(query)) {
      row.classList.remove('search-hidden');
    } else {
      row.classList.add('search-hidden');
    }
  }
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
