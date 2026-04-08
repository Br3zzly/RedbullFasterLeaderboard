const MAPS = [
  { uidKey: 'MAP1_UID', nameKey: 'MAP1_NAME' },
  { uidKey: 'MAP2_UID', nameKey: 'MAP2_NAME' },
  { uidKey: 'MAP3_UID', nameKey: 'MAP3_NAME' },
];

const NADEO_AUTH_URL = 'https://prod.trackmania.core.nadeo.online/v2/authentication/token/basic';
const NADEO_LIVE_URL = 'https://live-services.trackmania.nadeo.live';
const NADEO_CORE_URL = 'https://prod.trackmania.core.nadeo.online';
const TM_OAUTH_TOKEN_URL = 'https://api.trackmania.com/api/access_token';
const TM_DISPLAY_NAMES_URL = 'https://api.trackmania.com/api/display-names';
const USER_AGENT = 'redbull-faster-leaderboard / cloudflare-worker';
const PAGE_SIZE = 100;
const MAX_PAGES = 200; // 20000 players per map max
const PAGE_CONCURRENCY = 10; // Pages fetched in parallel per map
const KV_LEADERBOARD_KEY = 'leaderboard:v1';

// ── Nadeo Auth ────────────────────────────────────────────────────────
async function authenticateNadeo(login, password, audience) {
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
    throw new Error(`Nadeo auth failed: ${res.status} ${text}`);
  }
  return (await res.json()).accessToken;
}

// ── OAuth Auth (for display names) ────────────────────────────────────
async function authenticateOAuth(clientId, clientSecret) {
  const res = await fetch(TM_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth auth failed: ${res.status} ${text}`);
  }
  return (await res.json()).access_token;
}

// ── Leaderboard fetching ─────────────────────────────────────────────
async function fetchPage(mapUid, token, offset) {
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
  return data.tops?.[0]?.top || [];
}

// Fetch pages in parallel batches — ~10 round-trips instead of ~100.
async function fetchMapLeaderboard(mapUid, token) {
  const allRecords = [];
  let page = 0;

  while (page < MAX_PAGES) {
    const batchSize = Math.min(PAGE_CONCURRENCY, MAX_PAGES - page);
    const batch = [];
    for (let i = 0; i < batchSize; i++) {
      batch.push(fetchPage(mapUid, token, (page + i) * PAGE_SIZE));
    }
    const results = await Promise.all(batch);

    let hitEnd = false;
    for (const tops of results) {
      allRecords.push(...tops);
      if (tops.length < PAGE_SIZE) { hitEnd = true; break; }
    }
    if (hitEnd) break;
    page += batchSize;
  }

  return allRecords;
}

// ── Zones hierarchy ───────────────────────────────────────────────────
async function fetchZones(coreToken) {
  const url = `${NADEO_CORE_URL}/zones`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `nadeo_v1 t=${coreToken}`,
      'User-Agent': USER_AGENT,
    },
  });
  if (!res.ok) {
    console.error(`Zones fetch failed: ${res.status}`);
    return null;
  }
  return await res.json();
}

function buildZoneLookup(zones) {
  if (!zones || !Array.isArray(zones)) return { getCountryIso: () => null };

  const lookup = {};
  for (const z of zones) {
    lookup[z.zoneId] = { name: z.name, parentId: z.parentId };
  }

  let worldId = null;
  for (const z of zones) {
    if (!z.parentId) { worldId = z.zoneId; break; }
  }

  const continentIds = new Set();
  for (const z of zones) {
    if (z.parentId === worldId) continentIds.add(z.zoneId);
  }

  function getCountryName(zoneId) {
    let current = zoneId;
    const visited = new Set();
    while (current && !visited.has(current)) {
      visited.add(current);
      const zone = lookup[current];
      if (!zone) return null;
      if (continentIds.has(zone.parentId)) return zone.name;
      current = zone.parentId;
    }
    return null;
  }

  function getCountryIso(zoneId) {
    const name = getCountryName(zoneId);
    if (!name) return null;
    return COUNTRY_TO_ISO[name] || null;
  }

  return { getCountryIso };
}

const COUNTRY_TO_ISO = {
  'Afghanistan': 'af', 'Albania': 'al', 'Algeria': 'dz', 'Andorra': 'ad',
  'Angola': 'ao', 'Argentina': 'ar', 'Armenia': 'am', 'Australia': 'au',
  'Austria': 'at', 'Azerbaijan': 'az', 'Bahamas': 'bs', 'Bahrain': 'bh',
  'Bangladesh': 'bd', 'Belarus': 'by', 'Belgium': 'be', 'Belize': 'bz',
  'Bolivia': 'bo', 'Bosnia & Herzegovina': 'ba', 'Bosnia and Herzegovina': 'ba',
  'Brazil': 'br', 'Brunei': 'bn', 'Bulgaria': 'bg', 'Cambodia': 'kh',
  'Cameroon': 'cm', 'Canada': 'ca', 'Chile': 'cl', 'China': 'cn',
  'Colombia': 'co', 'Costa Rica': 'cr', 'Croatia': 'hr', 'Cuba': 'cu',
  'Cyprus': 'cy', 'Czech Republic': 'cz', 'Czechia': 'cz',
  'Denmark': 'dk', 'Dominican Republic': 'do', 'Ecuador': 'ec',
  'Egypt': 'eg', 'El Salvador': 'sv', 'Estonia': 'ee', 'Ethiopia': 'et',
  'Finland': 'fi', 'France': 'fr', 'Georgia': 'ge', 'Germany': 'de',
  'Ghana': 'gh', 'Greece': 'gr', 'Guatemala': 'gt', 'Honduras': 'hn',
  'Hong Kong': 'hk', 'Hungary': 'hu', 'Iceland': 'is', 'India': 'in',
  'Indonesia': 'id', 'Iran': 'ir', 'Iraq': 'iq', 'Ireland': 'ie',
  'Israel': 'il', 'Italy': 'it', 'Jamaica': 'jm', 'Japan': 'jp',
  'Jordan': 'jo', 'Kazakhstan': 'kz', 'Kenya': 'ke', 'Kosovo': 'xk',
  'Kuwait': 'kw', 'Kyrgyzstan': 'kg', 'Latvia': 'lv', 'Lebanon': 'lb',
  'Libya': 'ly', 'Liechtenstein': 'li', 'Lithuania': 'lt',
  'Luxembourg': 'lu', 'Macao': 'mo', 'Macau': 'mo', 'Madagascar': 'mg',
  'Malaysia': 'my', 'Malta': 'mt', 'Mauritius': 'mu', 'Mexico': 'mx',
  'Moldova': 'md', 'Monaco': 'mc', 'Mongolia': 'mn', 'Montenegro': 'me',
  'Morocco': 'ma', 'Mozambique': 'mz', 'Myanmar': 'mm', 'Namibia': 'na',
  'Nepal': 'np', 'Netherlands': 'nl', 'New Zealand': 'nz',
  'Nicaragua': 'ni', 'Nigeria': 'ng', 'North Macedonia': 'mk',
  'Norway': 'no', 'Oman': 'om', 'Pakistan': 'pk', 'Palestine': 'ps',
  'Panama': 'pa', 'Paraguay': 'py', 'Peru': 'pe', 'Philippines': 'ph',
  'Poland': 'pl', 'Portugal': 'pt', 'Puerto Rico': 'pr', 'Qatar': 'qa',
  'Romania': 'ro', 'Russia': 'ru', 'Rwanda': 'rw', 'Saudi Arabia': 'sa',
  'Senegal': 'sn', 'Serbia': 'rs', 'Singapore': 'sg', 'Slovakia': 'sk',
  'Slovenia': 'si', 'South Africa': 'za', 'South Korea': 'kr',
  'Spain': 'es', 'Sri Lanka': 'lk', 'Sweden': 'se', 'Switzerland': 'ch',
  'Syria': 'sy', 'Taiwan': 'tw', 'Thailand': 'th', 'Trinidad and Tobago': 'tt',
  'Tunisia': 'tn', 'Turkey': 'tr', 'Türkiye': 'tr', 'Ukraine': 'ua',
  'United Arab Emirates': 'ae', 'United Kingdom': 'gb',
  'United States': 'us', 'Uruguay': 'uy', 'Uzbekistan': 'uz',
  'Venezuela': 've', 'Vietnam': 'vn', 'Réunion': 're',
  'Guadeloupe': 'gp', 'Martinique': 'mq', 'French Guiana': 'gf',
  'New Caledonia': 'nc', 'French Polynesia': 'pf', 'Mayotte': 'yt',
  'Other Countries': null,
};

// ── Display names with KV cache ───────────────────────────────────────
const MAX_RESOLVE_PER_CYCLE = 200; // Max names to resolve per invocation (new + stale combined)

async function fetchDisplayNames(accountIds, oauthToken, kvNamespace) {
  const BATCH_SIZE = 50;
  const PARALLEL = 20;

  // 1. Load cached names from KV
  // Format: { accountId: { name: "PlayerName", ts: 1234567890 }, ... }
  let cached = {};
  try {
    const stored = await kvNamespace.get('names', 'json');
    if (stored) cached = stored;
  } catch {}

  const now = Date.now();

  // 2. Find IDs with no cached name (new players)
  const uncached = accountIds.filter(id => !cached[id]);

  // 3. Find oldest cached names to re-resolve (for renames)
  const byAge = accountIds
    .filter(id => cached[id])
    .sort((a, b) => (cached[a].ts || 0) - (cached[b].ts || 0));

  // 4. Budget: new players first, fill remaining with oldest cached
  const newToResolve = uncached.slice(0, MAX_RESOLVE_PER_CYCLE);
  const remaining = MAX_RESOLVE_PER_CYCLE - newToResolve.length;
  const staleToRefresh = remaining > 0 ? byAge.slice(0, remaining) : [];
  const toResolve = [...newToResolve, ...staleToRefresh];

  console.log(`Display names: ${Object.keys(cached).length} cached, ${uncached.length} new, resolving ${newToResolve.length} new + ${staleToRefresh.length} stale`);

  if (toResolve.length > 0) {
    const newNames = {};
    const batches = [];
    for (let i = 0; i < toResolve.length; i += BATCH_SIZE) {
      batches.push(toResolve.slice(i, i + BATCH_SIZE));
    }

    for (let g = 0; g < batches.length; g += PARALLEL) {
      const group = batches.slice(g, g + PARALLEL);
      const results = await Promise.all(group.map(async (batch) => {
        const params = batch.map(id => `accountId[]=${id}`).join('&');
        const url = `${TM_DISPLAY_NAMES_URL}?${params}`;
        try {
          const res = await fetch(url, {
            headers: {
              'Authorization': `Bearer ${oauthToken}`,
              'User-Agent': USER_AGENT,
            },
          });
          if (!res.ok) return {};
          const data = await res.json();
          return (typeof data === 'object' && !Array.isArray(data)) ? data : {};
        } catch {
          return {};
        }
      }));
      for (const r of results) Object.assign(newNames, r);
    }

    // Store with timestamp
    for (const [id, name] of Object.entries(newNames)) {
      cached[id] = { name, ts: now };
    }

    // Write updated cache to KV
    try {
      await kvNamespace.put('names', JSON.stringify(cached));
    } catch (e) {
      console.error('KV write failed:', e);
    }
  }

  // 5. Return flat { accountId: displayName } map
  const result = {};
  for (const id of accountIds) {
    if (cached[id]) result[id] = cached[id].name;
  }
  return result;
}

// ── Aggregation ───────────────────────────────────────────────────────
function aggregateLeaderboard(map1Records, map2Records, map3Records, zoneResolver) {
  const buildLookup = (records) => {
    const m = new Map();
    for (const r of records) {
      m.set(r.accountId, {
        score: r.score,
        position: r.position,
        timestamp: r.timestamp,
        zoneId: r.zoneId,
      });
    }
    return m;
  };

  const map1 = buildLookup(map1Records);
  const map2 = buildLookup(map2Records);
  const map3 = buildLookup(map3Records);

  const allIds = new Set([...map1.keys(), ...map2.keys(), ...map3.keys()]);

  const entries = [];
  for (const id of allIds) {
    const r1 = map1.get(id);
    const r2 = map2.get(id);
    const r3 = map3.get(id);

    const t1 = r1?.score ?? null;
    const t2 = r2?.score ?? null;
    const t3 = r3?.score ?? null;

    // Sum all available times for sorting
    const mapCount = (t1 !== null ? 1 : 0) + (t2 !== null ? 1 : 0) + (t3 !== null ? 1 : 0);
    const sumTime = (t1 ?? 0) + (t2 ?? 0) + (t3 ?? 0);

    const timestamps = [r1?.timestamp, r2?.timestamp, r3?.timestamp].filter(Boolean);
    const lastImproved = timestamps.length > 0 ? Math.max(...timestamps) : null;

    const zoneId = r1?.zoneId || r2?.zoneId || r3?.zoneId || null;
    const countryIso = zoneResolver ? zoneResolver(zoneId) : null;

    entries.push({
      accountId: id,
      map1Time: t1, map1Rank: r1?.position ?? null,
      map2Time: t2, map2Rank: r2?.position ?? null,
      map3Time: t3, map3Rank: r3?.position ?? null,
      sumTime, mapCount, lastImproved, countryIso,
    });
  }

  // Sort: more maps first, then by sum of available times
  entries.sort((a, b) => {
    if (a.mapCount !== b.mapCount) return b.mapCount - a.mapCount;
    return a.sumTime - b.sumTime;
  });

  // Assign ranks to everyone
  for (let i = 0; i < entries.length; i++) {
    entries[i].rank = i + 1;
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

// ── Build fresh leaderboard data ─────────────────────────────────────
async function buildLeaderboard(env) {
  const t0 = Date.now();

  const [liveToken, coreToken, oauthToken] = await Promise.all([
    authenticateNadeo(env.NADEO_LOGIN, env.NADEO_PASSWORD, 'NadeoLiveServices'),
    authenticateNadeo(env.NADEO_LOGIN, env.NADEO_PASSWORD, 'NadeoServices'),
    authenticateOAuth(env.OAUTH_CLIENT_ID, env.OAUTH_CLIENT_SECRET),
  ]);
  const tAuth = Date.now();

  const mapUids = MAPS.map(m => env[m.uidKey]);
  const mapNames = MAPS.map(m => env[m.nameKey]);

  const [map1Records, map2Records, map3Records, zones] = await Promise.all([
    fetchMapLeaderboard(mapUids[0], liveToken),
    fetchMapLeaderboard(mapUids[1], liveToken),
    fetchMapLeaderboard(mapUids[2], liveToken),
    fetchZones(coreToken),
  ]);
  const tMaps = Date.now();

  const { getCountryIso } = buildZoneLookup(zones);
  const entries = aggregateLeaderboard(map1Records, map2Records, map3Records, getCountryIso);

  const allAccountIds = entries.map(e => e.accountId);
  const displayNames = await fetchDisplayNames(allAccountIds, oauthToken, env.DISPLAY_NAMES);
  const tNames = Date.now();

  const leaderboard = entries.map(e => ({
    r: e.rank,
    n: displayNames[e.accountId] || e.accountId,
    f: e.countryIso,
    t1: e.map1Time, r1: e.map1Rank,
    t2: e.map2Time, r2: e.map2Rank,
    t3: e.map3Time, r3: e.map3Rank,
    s: e.sumTime,
    mc: e.mapCount,
    li: e.lastImproved,
  }));

  const json = JSON.stringify({
    l: leaderboard,
    mn: mapNames,
    lu: new Date().toISOString(),
    tp: leaderboard.length,
  });

  const timing = [
    `auth;dur=${tAuth - t0}`,
    `maps;dur=${tMaps - tAuth}`,
    `names;dur=${tNames - tMaps}`,
    `total;dur=${Date.now() - t0}`,
  ].join(', ');

  return { json, timing };
}

function wrapResponse(json, extraHeaders = {}) {
  return new Response(json, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=120',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

// ── Main handler ──────────────────────────────────────────────────────
// Cron writes to KV every 2 min. Requests read edge cache → KV → live build.
export default {
  async scheduled(event, env, ctx) {
    try {
      const { json, timing } = await buildLeaderboard(env);
      await env.DISPLAY_NAMES.put(KV_LEADERBOARD_KEY, json);
      console.log(`cron: rebuilt leaderboard (${timing})`);
    } catch (err) {
      console.error('cron error:', err);
    }
  },

  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/leaderboard') {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    const nocache = url.searchParams.has('nocache');
    const cache = caches.default;
    const cacheKey = new Request(new URL('/leaderboard', url.origin).toString());

    // 1. Edge cache
    if (!nocache) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const res = new Response(cached.body, cached);
        res.headers.set('X-Cache', 'edge');
        return res;
      }
    }

    // 2. KV (global)
    if (!nocache) {
      const kvJson = await env.DISPLAY_NAMES.get(KV_LEADERBOARD_KEY);
      if (kvJson) {
        const res = wrapResponse(kvJson, { 'X-Cache': 'kv' });
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      }
    }

    // 3. Live build — first deploy, or ?nocache
    try {
      const { json, timing } = await buildLeaderboard(env);
      ctx.waitUntil(env.DISPLAY_NAMES.put(KV_LEADERBOARD_KEY, json));
      const res = wrapResponse(json, { 'X-Cache': 'miss', 'Server-Timing': timing });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: err.message }, 500);
    }
  },
};
