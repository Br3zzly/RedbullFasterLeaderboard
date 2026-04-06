const MAPS = [
  { uidKey: 'MAP1_UID', nameKey: 'MAP1_NAME' },
  { uidKey: 'MAP2_UID', nameKey: 'MAP2_NAME' },
  { uidKey: 'MAP3_UID', nameKey: 'MAP3_NAME' },
];

const NADEO_AUTH_URL = 'https://prod.trackmania.core.nadeo.online/v2/authentication/token/basic';
const NADEO_LIVE_URL = 'https://live-services.trackmania.nadeo.live';
const NADEO_CORE_URL = 'https://prod.trackmania.core.nadeo.online';
const USER_AGENT = 'redbull-faster-leaderboard / cloudflare-worker';
const PAGE_SIZE = 100;
const MAX_PAGES = 20; // Safety cap: 2000 players per map max

// ── Auth ──────────────────────────────────────────────────────────────
async function authenticate(login, password, audience) {
  const credentials = btoa(`${login}:${password}`);
  const res = await fetch(NADEO_AUTH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ audience }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed (${audience}): ${res.status} ${text}`);
  }
  return (await res.json()).accessToken;
}

// ── Leaderboard fetching ──────────────────────────────────────────────
async function fetchMapLeaderboard(mapUid, token) {
  const allRecords = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const url = `${NADEO_LIVE_URL}/api/token/leaderboard/group/Personal_Best/map/${mapUid}/top?length=${PAGE_SIZE}&onlyWorld=true&offset=${offset}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `nadeo_v1 t=${token}`,
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Leaderboard fetch failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    const tops = data.tops?.[0]?.top || [];
    allRecords.push(...tops);
    if (tops.length < PAGE_SIZE) break; // No more pages
  }
  return allRecords;
}

// ── Display names ─────────────────────────────────────────────────────
async function fetchDisplayNames(accountIds, token) {
  const names = {};
  const BATCH_SIZE = 50;
  for (let i = 0; i < accountIds.length; i += BATCH_SIZE) {
    const batch = accountIds.slice(i, i + BATCH_SIZE);
    const url = `${NADEO_CORE_URL}/accounts/displayNames/?accountIdList=${batch.join(',')}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `nadeo_v1 t=${token}`,
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) {
      console.error(`Display names fetch failed: ${res.status}`);
      continue;
    }
    const data = await res.json();
    // Response is an array of { accountId, displayName, timestamp }
    if (Array.isArray(data)) {
      for (const entry of data) {
        names[entry.accountId] = entry.displayName;
      }
    } else if (typeof data === 'object') {
      // Some API versions return { accountId: displayName }
      Object.assign(names, data);
    }
  }
  return names;
}

// ── Aggregation ───────────────────────────────────────────────────────
function aggregateLeaderboard(map1Records, map2Records, map3Records) {
  // Build lookup: accountId -> time (ms)
  const map1Times = new Map();
  const map2Times = new Map();
  const map3Times = new Map();

  for (const r of map1Records) map1Times.set(r.accountId, r.score);
  for (const r of map2Records) map2Times.set(r.accountId, r.score);
  for (const r of map3Records) map3Times.set(r.accountId, r.score);

  // Collect all unique account IDs
  const allIds = new Set([...map1Times.keys(), ...map2Times.keys(), ...map3Times.keys()]);

  const entries = [];
  for (const id of allIds) {
    const t1 = map1Times.get(id) ?? null;
    const t2 = map2Times.get(id) ?? null;
    const t3 = map3Times.get(id) ?? null;
    const hasAll = t1 !== null && t2 !== null && t3 !== null;
    const total = hasAll ? t1 + t2 + t3 : null;
    entries.push({ accountId: id, map1Time: t1, map2Time: t2, map3Time: t3, totalTime: total, hasAll });
  }

  // Sort: players with all 3 times first (by total), then incomplete (by number of maps desc)
  entries.sort((a, b) => {
    if (a.hasAll && !b.hasAll) return -1;
    if (!a.hasAll && b.hasAll) return 1;
    if (a.hasAll && b.hasAll) return a.totalTime - b.totalTime;
    // Both incomplete: sort by number of times, then by sum of existing
    const aCount = (a.map1Time !== null ? 1 : 0) + (a.map2Time !== null ? 1 : 0) + (a.map3Time !== null ? 1 : 0);
    const bCount = (b.map1Time !== null ? 1 : 0) + (b.map2Time !== null ? 1 : 0) + (b.map3Time !== null ? 1 : 0);
    if (aCount !== bCount) return bCount - aCount;
    const aSum = (a.map1Time ?? 0) + (a.map2Time ?? 0) + (a.map3Time ?? 0);
    const bSum = (b.map1Time ?? 0) + (b.map2Time ?? 0) + (b.map3Time ?? 0);
    return aSum - bSum;
  });

  // Assign ranks (only for players with all 3 times)
  let rank = 1;
  for (const entry of entries) {
    if (entry.hasAll) {
      entry.rank = rank++;
    } else {
      entry.rank = null;
    }
  }

  return entries;
}

// ── CORS headers ──────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      ...CORS_HEADERS,
    },
  });
}

// ── Main handler ──────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname !== '/' && url.pathname !== '/leaderboard') {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    // Check cache first
    const cache = caches.default;
    const cacheKey = new Request(new URL('/leaderboard', request.url).toString());
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    try {
      // Authenticate with both audiences in parallel
      const [liveToken, coreToken] = await Promise.all([
        authenticate(env.NADEO_LOGIN, env.NADEO_PASSWORD, 'NadeoLiveServices'),
        authenticate(env.NADEO_LOGIN, env.NADEO_PASSWORD, 'NadeoServices'),
      ]);

      // Fetch all 3 map leaderboards in parallel
      const mapUids = MAPS.map(m => env[m.uidKey]);
      const mapNames = MAPS.map(m => env[m.nameKey]);

      const [map1Records, map2Records, map3Records] = await Promise.all(
        mapUids.map(uid => fetchMapLeaderboard(uid, liveToken))
      );

      // Aggregate
      const entries = aggregateLeaderboard(map1Records, map2Records, map3Records);

      // Fetch display names for all players
      const allAccountIds = entries.map(e => e.accountId);
      const displayNames = await fetchDisplayNames(allAccountIds, coreToken);

      // Build final response
      const leaderboard = entries.map(e => ({
        rank: e.rank,
        playerName: displayNames[e.accountId] || e.accountId,
        accountId: e.accountId,
        map1Time: e.map1Time,
        map2Time: e.map2Time,
        map3Time: e.map3Time,
        totalTime: e.totalTime,
      }));

      const responseData = {
        leaderboard,
        mapNames,
        lastUpdated: new Date().toISOString(),
        totalPlayers: leaderboard.length,
        rankedPlayers: leaderboard.filter(e => e.rank !== null).length,
      };

      const response = jsonResponse(responseData);

      // Cache for 60 seconds
      const cachedResponse = new Response(response.body, response);
      cachedResponse.headers.set('Cache-Control', 'public, max-age=60');
      await cache.put(cacheKey, cachedResponse.clone());

      return cachedResponse;
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: err.message }, 500);
    }
  },
};
