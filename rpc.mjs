// Spike: call Google Flights frontend RPCs (GetCalendarPicker, GetExploreDestinations)
// from plain Node fetch — no browser, no BotGuard token, no TLS impersonation.
// If Google requires the BotGuard attestation header, this spike is expected to fail;
// we do NOT try to generate or replay that token.

const BASE = 'https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
// Pre-accepted GDPR consent cookie, so EU requests are not redirected to consent.google.com.
export const CONSENT_COOKIE = 'CONSENT=YES+; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg';

let reqid = 100000 + Math.floor(Math.random() * 90000);

export async function callRpc(rpc, innerArray, { gl = 'GR', curr = 'EUR', hl = 'en', locale = null, withExt = true, withCookie = true } = {}) {
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
  if (withExt) headers['x-goog-ext-259736195-jspb'] = JSON.stringify([locale ?? `${hl}-US`, gl, curr, 1, null, [-180], null, null, 1, []]);
  if (hl !== 'en') headers['Accept-Language'] = `${hl},en;q=0.5`;
  if (withCookie) headers['Cookie'] = CONSENT_COOKIE;
  const t0 = Date.now();
  const res = await fetch(`${BASE}/${rpc}?${qs}`, { method: 'POST', headers, body: new URLSearchParams({ 'f.req': fReq }).toString(), signal: AbortSignal.timeout(35_000) });  // OK answers take ≤ ~31 s; error 13 arrives at ~21 s
  const text = await res.text();
  return { status: res.status, ms: Date.now() - t0, bytes: text.length, text, payloads: parseBatch(text), errorCode: rpcErrorCode(text) };
}

/** Server-side RPC error code (HTTP is still 200), e.g. 13 when the backend gives up — the website then shows "Oops, something went wrong". */
export function rpcErrorCode(text) {
  const m = text.match(/\["wrb\.fr",null,null,null,null,\[(\d+)/);
  return m ? Number(m[1]) : null;
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

// maxStops code (leg[3]) — hypothesis, verified by the pipeline probe: 0 = any, 1 = nonstop, 2 = ≤1 stop, 3 = ≤2 stops.
// A place is an airport code ('SKG', type 0) or [code, type] — e.g. ['/m/04jpl', 4] for a whole city.
const place = (x) => (Array.isArray(x) ? x : [x, 0]);
// selected (leg[8]): segments of an already chosen leg, [[from, date, to, null, carrier, number], ...].
const leg = (from, to, date, stopsCode = 0, selected = null) =>
  [[[place(from)]], [[place(to)]], null, stopsCode, null, null, date, null, selected, null, null, null, null, null, 3];

/** RT price per departure day in [winFrom, winTo] for trip length nights∈[minN,maxN]. maxStops: null = any. */
export function calendarReq({ origin, dest, out, back, winFrom, winTo, minN, maxN }) {
  return [null, [null, null, 1, null, [], 1, [1, 0, 0, 0], null, null, null, null, null, null,
    [leg(origin, dest, out), leg(dest, origin, back)], null, null, null, 1],
    [winFrom, winTo], null, [minN, maxN]];
}

/** Cheapest destinations in a region/anywhere. Places are Freebase MIDs: [mid, type] (4 = city, 6 = region). */
/**
 * flex = [month, length]: month 0 = "the next 6 months", 1–12 = that month (next occurrence);
 * length 1 = weekend, 2 = 1 week, 3 = 2 weeks ([] = default [0, 2]). tripType 1 = round trip, 2 = one-way.
 */
export function exploreReq({ origin, region, flex = [], tripType = 1 }) {
  const out = [[[[origin[0], origin[1]]]], [[[region[0], region[1]]]], null, 0];
  const back = [[[[region[0], region[1]]]], [[[origin[0], origin[1]]]], null, 0];
  return [[], null, null, [null, null, tripType, null, flex, 1, [1, 0, 0, 0], null, null, null, null, null, null,
    tripType === 2 ? [out] : [out, back],
    null, null, null, 0, null, null, null, null, null, null, null, 1], null, 1, null, 0, null, 0, [964, 870], 4];
}

/** Itineraries for one round trip (outbound options, each priced as the RT total). sort: 2 = the "Cheapest" tab, 1 = "Best". */
export function shoppingReq({ origin, dest, out, back, stopsCode = 0, sort = 2 }) {
  return [[], [null, null, 1, null, [], 1, [1, 0, 0, 0], null, null, null, null, null, null,
    [leg(origin, dest, out, stopsCode), leg(dest, origin, back, stopsCode)], null, null, null, 1], 0, 0, 0, sort];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * callRpc with retries on transient failures: network error, non-200, or server error 13
 * (backend gave up; the website shows "Oops, something went wrong" at the same moment).
 */
export async function callRpcRetry(rpc, innerArray, { retries = 2, backoffMs = [5_000, 15_000], ...opts } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(backoffMs[attempt - 1] ?? backoffMs.at(-1));
    try { last = await callRpc(rpc, innerArray, opts); }
    catch (e) { last = { status: 'ERR', error: e.message, ms: 0, bytes: 0, text: '', payloads: [], errorCode: null }; }
    last.attempts = attempt + 1;
    if (last.status === 200 && last.errorCode !== 13) return last;
  }
  return last;
}

/** Return-leg options for a chosen outbound (token + segments from shoppingRows). Each row is priced as the RT total. */
export function inboundReq({ origin, dest, out, back, token, segments, stopsCode = 0 }) {
  const selected = segments.map(s => [s.from, s.depDate, s.to, null, s.carrierCode, s.number]);
  return [[null, token], [null, null, 1, null, [], 1, [1, 0, 0, 0], null, null, null, null, null, null,
    [leg(origin, dest, out, stopsCode, selected), leg(dest, origin, back, stopsCode)], null, null, null, 1], 0, 0, 0, 1];
}

/** One-way itineraries (outbound only), cheapest first ("Cheapest" tab). */
export function shoppingOwReq({ origin, dest, out, stopsCode = 0 }) {
  return [[], [null, null, 2, null, [], 1, [1, 0, 0, 0], null, null, null, null, null, null,
    [leg(origin, dest, out, stopsCode)], null, null, null, 1], 0, 0, 0, 2];
}
