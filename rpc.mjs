// Spike: call Google Flights frontend RPCs (GetCalendarPicker, GetExploreDestinations)
// from plain Node fetch — no browser, no BotGuard token, no TLS impersonation.
// If Google requires the BotGuard attestation header, this spike is expected to fail;
// we do NOT try to generate or replay that token.

const BASE = 'https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
// Pre-accepted GDPR consent cookie, so EU requests are not redirected to consent.google.com.
export const CONSENT_COOKIE = 'CONSENT=YES+; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg';

let reqid = 100000 + Math.floor(Math.random() * 90000);

export async function callRpc(rpc, innerArray, { gl = 'GR', curr = 'EUR', hl = 'en', withExt = true, withCookie = true } = {}) {
  const fReq = JSON.stringify([null, JSON.stringify(innerArray)]);
  const qs = new URLSearchParams({ hl, gl, 'soc-app': '162', 'soc-platform': '1', 'soc-device': '1', _reqid: String(reqid += 100000), rt: 'c' });
  const headers = {
    'User-Agent': UA,
    'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.google.com',
    'Referer': 'https://www.google.com/travel/flights',
    'X-Same-Domain': '1',
  };
  if (withExt) headers['x-goog-ext-259736195-jspb'] = JSON.stringify([`${hl}-US`, gl, curr, 1, null, [-180], null, null, 1, []]);
  if (withCookie) headers['Cookie'] = CONSENT_COOKIE;
  const t0 = Date.now();
  const res = await fetch(`${BASE}/${rpc}?${qs}`, { method: 'POST', headers, body: new URLSearchParams({ 'f.req': fReq }).toString() });
  const text = await res.text();
  return { status: res.status, ms: Date.now() - t0, bytes: text.length, text, payloads: parseBatch(text) };
}

/** Parse a batchexecute rt=c response: ")]}'" + length-prefixed JSON chunks; return parsed "wrb.fr" payloads. */
export function parseBatch(text) {
  const out = [];
  const body = text.replace(/^\)\]\}'\s*/, '');
  // Each chunk: <length>\n<json>. Scan for JSON arrays starting with [["wrb.fr"
  const re = /\[\["wrb\.fr"/g;
  let m;
  while ((m = re.exec(body))) {
    // find the matching end of this JSON array by bracket counting (strings aware)
    let i = m.index, depth = 0, inStr = false, esc = false;
    for (; i < body.length; i++) {
      const c = body[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '[') depth++; else if (c === ']') { depth--; if (depth === 0) break; }
    }
    try {
      const arr = JSON.parse(body.slice(m.index, i + 1));
      for (const e of arr) if (e[0] === 'wrb.fr' && typeof e[2] === 'string') out.push(JSON.parse(e[2]));
    } catch { /* partial chunk */ }
  }
  return out;
}

// ── request builders (shapes captured from the live web client 2026-10-21) ──

const leg = (from, to, date, fromType = 0, toType = 0) =>
  [[[[from, fromType]]], [[[to, toType]]], null, 0, null, null, date, null, null, null, null, null, null, null, 3];

/** RT price per departure day in [winFrom, winTo] for trip length nights∈[minN,maxN]. maxStops: null = any. */
export function calendarReq({ origin, dest, out, back, winFrom, winTo, minN, maxN }) {
  return [null, [null, null, 1, null, [], 1, [1, 0, 0, 0], null, null, null, null, null, null,
    [leg(origin, dest, out), leg(dest, origin, back)], null, null, null, 1],
    [winFrom, winTo], null, [minN, maxN]];
}

/** Cheapest destinations in a region/anywhere. Places are Freebase MIDs: [mid, type] (4 = city, 6 = region). */
export function exploreReq({ origin, region }) {
  return [[], null, null, [null, null, 1, null, [], 1, [1, 0, 0, 0], null, null, null, null, null, null,
    [[[[[origin[0], origin[1]]]], [[[region[0], region[1]]]], null, 0], [[[[region[0], region[1]]]], [[[origin[0], origin[1]]]], null, 0]],
    null, null, null, 0, null, null, null, null, null, null, null, 1], null, 1, null, 0, null, 0, [964, 870], 4];
}
