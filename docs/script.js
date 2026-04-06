// ── Configuration ─────────────────────────────────────────────────────
// Replace with your Cloudflare Worker URL after deployment
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

let countdownTimer = null;
let secondsLeft = REFRESH_INTERVAL;

// ── Time formatting ───────────────────────────────────────────────────
function formatTime(ms) {
  if (ms === null || ms === undefined) return null;
  const totalMs = Math.abs(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ── Rendering ─────────────────────────────────────────────────────────
function renderLeaderboard(data) {
  // Set map headers
  if (data.mapNames) {
    $mapHeader1.textContent = data.mapNames[0] || 'Map 1';
    $mapHeader2.textContent = data.mapNames[1] || 'Map 2';
    $mapHeader3.textContent = data.mapNames[2] || 'Map 3';
  }

  $playerCount.textContent = data.rankedPlayers ?? data.leaderboard.length;
  $lastUpdated.textContent = data.lastUpdated ? timeAgo(data.lastUpdated) : '—';

  // Build rows
  const fragment = document.createDocumentFragment();
  let addedSeparator = false;

  for (const entry of data.leaderboard) {
    // Add separator before unranked players
    if (entry.rank === null && !addedSeparator) {
      addedSeparator = true;
      const sepRow = document.createElement('tr');
      sepRow.className = 'separator-row';
      sepRow.innerHTML = `<td colspan="6">Incomplete — missing map times</td>`;
      fragment.appendChild(sepRow);
    }

    const tr = document.createElement('tr');
    if (entry.rank === 1) tr.className = 'top-1';
    else if (entry.rank === 2) tr.className = 'top-2';
    else if (entry.rank === 3) tr.className = 'top-3';

    const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : (entry.rank === null ? 'rank-unranked' : '');
    const rankText = entry.rank !== null ? entry.rank : '—';

    const t1 = formatTime(entry.map1Time);
    const t2 = formatTime(entry.map2Time);
    const t3 = formatTime(entry.map3Time);
    const total = formatTime(entry.totalTime);

    tr.innerHTML = `
      <td class="col-rank ${rankClass}">${rankText}</td>
      <td class="col-player">${escapeHtml(entry.playerName)}</td>
      <td class="col-time ${t1 === null ? 'time-missing' : ''}">${t1 ?? '—'}</td>
      <td class="col-time ${t2 === null ? 'time-missing' : ''}">${t2 ?? '—'}</td>
      <td class="col-time ${t3 === null ? 'time-missing' : ''}">${t3 ?? '—'}</td>
      <td class="col-total ${total === null ? 'total-incomplete' : ''}">${total ?? '—'}</td>
    `;
    fragment.appendChild(tr);
  }

  $tbody.innerHTML = '';
  $tbody.appendChild(fragment);

  $loading.style.display = 'none';
  $error.style.display = 'none';
  $table.style.display = 'table';
}

function showError(message) {
  $loading.style.display = 'none';
  $error.style.display = 'block';
  $error.textContent = `Error: ${message}`;
  $table.style.display = 'none';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

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
    // Only show error if we don't have data yet
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
