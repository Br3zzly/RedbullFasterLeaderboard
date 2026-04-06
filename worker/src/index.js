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
const MAX_PAGES = 20;

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

// ── Leaderboard fetching (captures position, timestamp, zoneId) ──────
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
    if (tops.length < PAGE_SIZE) break;
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

// Build zone lookup and country resolver from zones hierarchy
function buildZoneLookup(zones) {
  if (!zones || !Array.isArray(zones)) return { lookup: {}, getCountry: () => null };

  const lookup = {};
  for (const z of zones) {
    lookup[z.zoneId] = { name: z.name, parentId: z.parentId, icon: z.icon || '' };
  }

  // Find World zone ID (top-level, parentId is null or not present)
  let worldId = null;
  for (const z of zones) {
    if (!z.parentId) { worldId = z.zoneId; break; }
  }

  // Continent IDs are direct children of World
  const continentIds = new Set();
  for (const z of zones) {
    if (z.parentId === worldId) continentIds.add(z.zoneId);
  }

  // Country = zone whose parent is a continent
  function getCountryForZone(zoneId) {
    let current = zoneId;
    const visited = new Set();
    while (current && !visited.has(current)) {
      visited.add(current);
      const zone = lookup[current];
      if (!zone) return null;
      if (continentIds.has(zone.parentId)) {
        // This zone's parent is a continent, so this is a country
        return zone.name;
      }
      current = zone.parentId;
    }
    return null;
  }

  return { lookup, getCountry: getCountryForZone };
}

// Map country names to ISO 3166-1 alpha-2 codes
const COUNTRY_TO_ISO = {
  'Afghanistan': 'AF', 'Albania': 'AL', 'Algeria': 'DZ', 'Andorra': 'AD',
  'Angola': 'AO', 'Argentina': 'AR', 'Armenia': 'AM', 'Australia': 'AU',
  'Austria': 'AT', 'Azerbaijan': 'AZ', 'Bahamas': 'BS', 'Bahrain': 'BH',
  'Bangladesh': 'BD', 'Belarus': 'BY', 'Belgium': 'BE', 'Belize': 'BZ',
  'Bolivia': 'BO', 'Bosnia & Herzegovina': 'BA', 'Bosnia and Herzegovina': 'BA',
  'Brazil': 'BR', 'Brunei': 'BN', 'Bulgaria': 'BG', 'Cambodia': 'KH',
  'Cameroon': 'CM', 'Canada': 'CA', 'Chile': 'CL', 'China': 'CN',
  'Colombia': 'CO', 'Costa Rica': 'CR', 'Croatia': 'HR', 'Cuba': 'CU',
  'Cyprus': 'CY', 'Czech Republic': 'CZ', 'Czechia': 'CZ',
  'Denmark': 'DK', 'Dominican Republic': 'DO', 'Ecuador': 'EC',
  'Egypt': 'EG', 'El Salvador': 'SV', 'Estonia': 'EE', 'Ethiopia': 'ET',
  'Finland': 'FI', 'France': 'FR', 'Georgia': 'GE', 'Germany': 'DE',
  'Ghana': 'GH', 'Greece': 'GR', 'Guatemala': 'GT', 'Honduras': 'HN',
  'Hong Kong': 'HK', 'Hungary': 'HU', 'Iceland': 'IS', 'India': 'IN',
  'Indonesia': 'ID', 'Iran': 'IR', 'Iraq': 'IQ', 'Ireland': 'IE',
  'Israel': 'IL', 'Italy': 'IT', 'Jamaica': 'JM', 'Japan': 'JP',
  'Jordan': 'JO', 'Kazakhstan': 'KZ', 'Kenya': 'KE', 'Kosovo': 'XK',
  'Kuwait': 'KW', 'Kyrgyzstan': 'KG', 'Latvia': 'LV', 'Lebanon': 'LB',
  'Libya': 'LY', 'Liechtenstein': 'LI', 'Lithuania': 'LT',
  'Luxembourg': 'LU', 'Macao': 'MO', 'Macau': 'MO', 'Madagascar': 'MG',
  'Malaysia': 'MY', 'Malta': 'MT', 'Mauritius': 'MU', 'Mexico': 'MX',
  'Moldova': 'MD', 'Monaco': 'MC', 'Mongolia': 'MN', 'Montenegro': 'ME',
  'Morocco': 'MA', 'Mozambique': 'MZ', 'Myanmar': 'MM', 'Namibia': 'NA',
  'Nepal': 'NP', 'Netherlands': 'NL', 'New Zealand': 'NZ',
  'Nicaragua': 'NI', 'Nigeria': 'NG', 'North Macedonia': 'MK',
  'Norway': 'NO', 'Oman': 'OM', 'Pakistan': 'PK', 'Palestine': 'PS',
  'Panama': 'PA', 'Paraguay': 'PY', 'Peru': 'PE', 'Philippines': 'PH',
  'Poland': 'PL', 'Portugal': 'PT', 'Puerto Rico': 'PR', 'Qatar': 'QA',
  'Romania': 'RO', 'Russia': 'RU', 'Rwanda': 'RW', 'Saudi Arabia': 'SA',
  'Senegal': 'SN', 'Serbia': 'RS', 'Singapore': 'SG', 'Slovakia': 'SK',
  'Slovenia': 'SI', 'South Africa': 'ZA', 'South Korea': 'KR',
  'Spain': 'ES', 'Sri Lanka': 'LK', 'Sweden': 'SE', 'Switzerland': 'CH',
  'Syria': 'SY', 'Taiwan': 'TW', 'Thailand': 'TH', 'Trinidad and Tobago': 'TT',
  'Tunisia': 'TN', 'Turkey': 'TR', 'Türkiye': 'TR', 'Ukraine': 'UA',
  'United Arab Emirates': 'AE', 'United Kingdom': 'GB',
  'United States': 'US', 'Uruguay': 'UY', 'Uzbekistan': 'UZ',
  'Venezuela': 'VE', 'Vietnam': 'VN', 'Réunion': 'RE',
  'Guadeloupe': 'GP', 'Martinique': 'MQ', 'French Guiana': 'GF',
  'New Caledonia': 'NC', 'French Polynesia': 'PF', 'Mayotte': 'YT',
  'Other Countries': null,
};

function countryToFlag(countryName) {
  if (!countryName) return null;
  const iso = COUNTRY_TO_ISO[countryName];
  if (!iso) return null;
  // Convert ISO code to flag emoji (regional indicator symbols)
  return String.fromCodePoint(
    ...iso.split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
  );
}

// ── Display names (OAuth API) ─────────────────────────────────────────
async function fetchDisplayNames(accountIds, oauthToken) {
  const names = {};
  const BATCH_SIZE = 50;
  for (let i = 0; i < accountIds.length; i += BATCH_SIZE) {
    const batch = accountIds.slice(i, i + BATCH_SIZE);
    const params = batch.map(id => `accountId[]=${id}`).join('&');
    const url = `${TM_DISPLAY_NAMES_URL}?${params}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${oauthToken}`,
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) {
      console.error(`Display names fetch failed: ${res.status}`);
      continue;
    }
    const data = await res.json();
    if (typeof data === 'object' && !Array.isArray(data)) {
      Object.assign(names, data);
    }
  }
  return names;
}

// ── Aggregation ───────────────────────────────────────────────────────
function aggregateLeaderboard(map1Records, map2Records, map3Records, zoneResolver) {
  // Build lookups: accountId -> { score, position, timestamp, zoneId }
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
    const hasAll = t1 !== null && t2 !== null && t3 !== null;
    const total = hasAll ? t1 + t2 + t3 : null;

    // Get the most recent timestamp across all maps for "last improved"
    const timestamps = [r1?.timestamp, r2?.timestamp, r3?.timestamp].filter(Boolean);
    const lastImproved = timestamps.length > 0 ? Math.max(...timestamps) : null;

    // Get zone from whichever map record exists
    const zoneId = r1?.zoneId || r2?.zoneId || r3?.zoneId || null;
    const country = zoneResolver ? zoneResolver(zoneId) : null;

    entries.push({
      accountId: id,
      map1Time: t1, map1Rank: r1?.position ?? null,
      map2Time: t2, map2Rank: r2?.position ?? null,
      map3Time: t3, map3Rank: r3?.position ?? null,
      totalTime: total, hasAll, lastImproved,
      country: country,
      countryFlag: countryToFlag(country),
    });
  }

  // Sort
  entries.sort((a, b) => {
    if (a.hasAll && !b.hasAll) return -1;
    if (!a.hasAll && b.hasAll) return 1;
    if (a.hasAll && b.hasAll) return a.totalTime - b.totalTime;
    const aCount = (a.map1Time !== null ? 1 : 0) + (a.map2Time !== null ? 1 : 0) + (a.map3Time !== null ? 1 : 0);
    const bCount = (b.map1Time !== null ? 1 : 0) + (b.map2Time !== null ? 1 : 0) + (b.map3Time !== null ? 1 : 0);
    if (aCount !== bCount) return bCount - aCount;
    const aSum = (a.map1Time ?? 0) + (a.map2Time ?? 0) + (a.map3Time ?? 0);
    const bSum = (b.map1Time ?? 0) + (b.map2Time ?? 0) + (b.map3Time ?? 0);
    return aSum - bSum;
  });

  let rank = 1;
  for (const entry of entries) {
    entry.rank = entry.hasAll ? rank++ : null;
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
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/leaderboard') {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    // Check cache first — all users share this cached response
    const cache = caches.default;
    const cacheKey = new Request(new URL('/leaderboard', request.url).toString());
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    try {
      // Authenticate: Nadeo Live + Nadeo Core (zones) + OAuth (names) in parallel
      const [liveToken, coreToken, oauthToken] = await Promise.all([
        authenticateNadeo(env.NADEO_LOGIN, env.NADEO_PASSWORD, 'NadeoLiveServices'),
        authenticateNadeo(env.NADEO_LOGIN, env.NADEO_PASSWORD, 'NadeoServices'),
        authenticateOAuth(env.OAUTH_CLIENT_ID, env.OAUTH_CLIENT_SECRET),
      ]);

      // Fetch leaderboards + zones in parallel
      const mapUids = MAPS.map(m => env[m.uidKey]);
      const mapNames = MAPS.map(m => env[m.nameKey]);

      const [map1Records, map2Records, map3Records, zones] = await Promise.all([
        fetchMapLeaderboard(mapUids[0], liveToken),
        fetchMapLeaderboard(mapUids[1], liveToken),
        fetchMapLeaderboard(mapUids[2], liveToken),
        fetchZones(coreToken),
      ]);

      // Build zone resolver
      const { getCountry } = buildZoneLookup(zones);

      // Aggregate with map ranks, timestamps, and country data
      const entries = aggregateLeaderboard(map1Records, map2Records, map3Records, getCountry);

      // Fetch display names
      const allAccountIds = entries.map(e => e.accountId);
      const displayNames = await fetchDisplayNames(allAccountIds, oauthToken);

      // Build final response
      const leaderboard = entries.map(e => ({
        rank: e.rank,
        playerName: displayNames[e.accountId] || e.accountId,
        accountId: e.accountId,
        countryFlag: e.countryFlag,
        country: e.country,
        map1Time: e.map1Time, map1Rank: e.map1Rank,
        map2Time: e.map2Time, map2Rank: e.map2Rank,
        map3Time: e.map3Time, map3Rank: e.map3Rank,
        totalTime: e.totalTime,
        lastImproved: e.lastImproved,
      }));

      const responseData = {
        leaderboard,
        mapNames,
        lastUpdated: new Date().toISOString(),
        totalPlayers: leaderboard.length,
        rankedPlayers: leaderboard.filter(e => e.rank !== null).length,
      };

      const response = jsonResponse(responseData);
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
