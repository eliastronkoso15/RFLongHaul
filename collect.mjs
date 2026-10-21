// Daily long-haul collector.
//   calendar (2 trip lengths × 6 months) → cheapest spaced dates → itineraries → quality filter
//   → return leg for the chosen outbound → card. Plus an Explore discovery list per origin.
// Writes the public JSON (schema v1) and a history entry for the norm.
//
//   node collect.mjs [--out out/longhaul.json] [--history data/history] [--only SKG-PVG,ATH-BKK]
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { callRpcRetry, calendarReq, exploreReq, shoppingReq, inboundReq } from './rpc.mjs';
import { calendarRows, exploreRows, shoppingRows } from './parse.mjs';
import { ORIGINS, DESTS, NIGHTS, LEAD_DAYS, WINDOW_DAYS, CANDIDATES, SPARE_CANDIDATES, QUALITY, LOW_COST, EXPLORE, GAP_MS } from './config.mjs';
import { flightsUrl } from './tfs.mjs';
import { loadHistory, routeNorm, dealFor } from './norm.mjs';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const OUT = arg('out', 'out/longhaul.json');
const HISTORY_DIR = arg('history', null);
const ONLY = arg('only', null)?.split(',').map(s => s.trim().toUpperCase());

const sleep = ms => new Promise(r => setTimeout(r, ms));
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const fmtDur = m => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;

const startedAt = new Date();
const TODAY = startedAt.toISOString().slice(0, 10);
const WIN_FROM = addDays(TODAY, LEAD_DAYS);
const WIN_TO = addDays(WIN_FROM, WINDOW_DAYS);
const stats = { calls: 0, retries: 0, failedCalls: 0 };

// Calendar answers are cheap and decide everything downstream: 2 retries. An itinerary call that hits
// error 13 hangs ~21 s per attempt and has spare dates behind it: 1 retry.
const RETRIES = { GetCalendarPicker: 2, GetExploreDestinations: 1, GetShoppingResults: 1 };

// One lane per origin; each lane paces its own calls.
async function rpc(name, req, lane) {
  if (lane.calls++) await sleep(GAP_MS);
  stats.calls++;
  const r = await callRpcRetry(name, req, { retries: RETRIES[name] ?? 1, backoffMs: [8_000, 20_000] });
  stats.retries += (r.attempts ?? 1) - 1;
  if (r.status !== 200 || r.errorCode) stats.failedCalls++;
  return r;
}
const failed = r => r.status !== 200 || !!r.errorCode;

function qualityIssues(it) {
  const why = [];
  if (it.stops > QUALITY.maxStops) why.push(`${it.stops} stops`);
  for (const l of it.layovers) {
    if (l.minutes > QUALITY.maxLayover) why.push(`layover ${fmtDur(l.minutes)} ${l.airport}`);
    if (l.minutes < QUALITY.minLayover) why.push(`layover ${l.minutes}m ${l.airport}`);
    if (l.changeAirport) why.push(`airport change ${l.airport}`);
  }
  if (it.durationMin > QUALITY.maxDurationMin) why.push(`total ${fmtDur(it.durationMin)}`);
  return why;
}

const legSummary = it => ({
  dep: it.dep, arr: it.arr, plusDays: it.plusDays, durationMin: it.durationMin,
  flights: it.flights.filter(Boolean), layovers: it.layovers.map(l => ({ airport: l.airport, minutes: l.minutes })),
});

function monthFloors(rows) {
  const f = {};
  for (const r of rows) { const m = r.out.slice(0, 7); f[m] = Math.min(f[m] ?? Infinity, r.price); }
  return f;
}

async function collectRoute(o, d, lane) {
  const pool = [];
  const floors = {};
  for (const n of NIGHTS) {
    const r = await rpc('GetCalendarPicker', calendarReq({ origin: o, dest: d, out: WIN_FROM, back: addDays(WIN_FROM, n), winFrom: WIN_FROM, winTo: WIN_TO, minN: n, maxN: n }), lane);
    const rows = calendarRows(r.payloads).filter(x => x.price);
    floors[n] = monthFloors(rows);
    for (const x of rows) pool.push({ ...x, nights: n });
  }
  if (!pool.length) return { skip: 'no calendar prices', floors };
  pool.sort((a, b) => a.price - b.price || a.out.localeCompare(b.out));
  const calendarMin = pool[0].price;

  // Cheapest dates; for the same trip length keep them ≥ 7 days apart. Spares replace dates that error.
  const picks = [];
  for (const c of pool) {
    if (picks.every(p => p.nights !== c.nights || Math.abs(daysBetween(p.out, c.out)) >= 7)) picks.push(c);
    if (picks.length === CANDIDATES + SPARE_CANDIDATES) break;
  }

  let best = null, answered = 0;
  const errors = [];
  for (const p of picks) {
    if (answered >= CANDIDATES) break;
    const r = await rpc('GetShoppingResults', shoppingReq({ origin: o, dest: d, out: p.out, back: p.back }), lane);
    if (failed(r)) { errors.push(r.errorCode ?? r.status); continue; }
    answered++;
    for (const it of shoppingRows(r.payloads)) {
      if (qualityIssues(it).length) continue;
      if (!best || it.price < best.price) best = { ...it, out: p.out, back: p.back, nights: p.nights };
    }
  }
  if (!best) return { skip: answered ? 'no itinerary passed the quality filter' : `Google error ${[...new Set(errors)].join(',')} on all dates`, floors, calendarMin };

  // Return leg for the chosen outbound. Rows are priced as the round-trip total of that combination.
  let inbound = null, price = best.price;
  if (best.token) {
    const r = await rpc('GetShoppingResults', inboundReq({ origin: o, dest: d, out: best.out, back: best.back, token: best.token, segments: best.segments }), lane);
    if (!failed(r)) {
      const good = shoppingRows(r.payloads).filter(it => !qualityIssues(it).length);
      if (good.length) { inbound = good[0]; price = good[0].price; }
    }
  }

  const airlineCodes = [...new Set([...best.segments, ...(inbound?.segments ?? [])].map(s => s.carrierCode).filter(Boolean))];
  const card = {
    dest: d, ...DESTS[d],
    price, currency: 'EUR', out: best.out, back: best.back, nights: best.nights,
    airline: best.airlines.join(' + '), airlineCodes,
    lowCost: airlineCodes.length > 0 && airlineCodes.every(c => LOW_COST.has(c)),
    via: best.layovers[0]?.airport ?? null, stops: best.stops,
    outbound: legSummary(best), inbound: inbound ? legSummary(inbound) : null,
    calendarMin, url: flightsUrl({ origin: o, dest: d, out: best.out, back: best.back }),
    checkedAt: new Date().toISOString(),
  };
  return { card, floors, calendarMin, errors };
}

async function explore(mid, lane) {
  const out = {};
  for (const [key, flex] of Object.entries(EXPLORE.flex)) {
    const r = await rpc('GetExploreDestinations', exploreReq({ origin: [mid, 4], region: EXPLORE.region, flex }), lane);
    out[key] = failed(r) ? [] : exploreRows(r.payloads).slice(0, EXPLORE.keep)
      .map(x => ({ city: x.city, country: x.country, iata: x.iata, price: x.price, out: x.out, back: x.back, stops: x.stops, airline: x.airline, durationMin: x.durMin }));
  }
  return out;
}

// ── run ─────────────────────────────────────────────────────────────────────
const history = loadHistory(HISTORY_DIR, { today: TODAY });
const doc = {
  schemaVersion: 1, generatedAt: null, source: 'google-flights-rpc',
  window: { from: WIN_FROM, to: WIN_TO }, nights: NIGHTS, quality: QUALITY,
  origins: {}, stats,
};
const historyEntry = { date: TODAY, routes: {} };
const md = [`# Long-haul collect — ${TODAY} (${process.env.GITHUB_ACTIONS ? 'github-actions' : 'local'})`, '',
  `Window ${WIN_FROM} … ${WIN_TO}, nights ${NIGHTS.join('/')}, history files: ${history.length}`, '',
  '| Route | Card | Calendar min | Airline · via · outbound | Deal | Note |', '|---|---|---|---|---|---|'];

async function collectOrigin(o, mid) {
  const lane = { calls: 0 };
  const rows = [];
  const routes = Object.keys(DESTS).filter(d => !ONLY || ONLY.includes(`${o}-${d}`));
  if (ONLY && !routes.length) return rows;
  const cards = [], skipped = [];
  for (const d of routes) {
    const key = `${o}-${d}`;
    let res;
    try { res = await collectRoute(o, d, lane); } catch (e) { res = { skip: `exception: ${e.message}` }; }
    historyEntry.routes[key] = { cardPrice: res.card?.price ?? null, cardOut: res.card?.out ?? null, cardNights: res.card?.nights ?? null, floors: res.floors ?? {} };
    if (res.card) {
      const norm = routeNorm(history, key, { today: TODAY });
      res.card.norm = norm;
      res.card.deal = dealFor(res.card.price, norm);
      cards.push(res.card);
      const c = res.card;
      rows.push(`| ${key} | €${c.price} ${c.out}→${c.back} (${c.nights}n) | €${res.calendarMin} | ${c.airline} · ${c.via ?? 'nonstop'} · ${fmtDur(c.outbound.durationMin)}${c.inbound ? ` / back ${fmtDur(c.inbound.durationMin)}` : ''} | ${c.deal ? `−€${c.deal.amount}` : (norm ? `norm €${norm.median} (${norm.samples})` : '—')} | ${res.errors?.length ? `errors ${res.errors.join(',')} (retried)` : ''} |`);
    } else {
      skipped.push({ dest: d, reason: res.skip });
      rows.push(`| ${key} | — | ${res.calendarMin ? `€${res.calendarMin}` : '—'} | — | — | skipped: ${res.skip} |`);
    }
  }
  cards.sort((a, b) => (b.deal?.amount ?? 0) - (a.deal?.amount ?? 0) || a.price - b.price);
  doc.origins[o] = { cards, skipped, explore: ONLY ? null : await explore(mid, lane) };
  return rows;
}

const laneRows = await Promise.all(Object.entries(ORIGINS).map(([o, { mid }]) => collectOrigin(o, mid)));
for (const rows of laneRows) md.push(...rows);
// Stable origin order in the JSON regardless of which lane finished first.
doc.origins = Object.fromEntries(Object.keys(ORIGINS).filter(o => doc.origins[o]).map(o => [o, doc.origins[o]]));

doc.generatedAt = new Date().toISOString();
const totalCards = Object.values(doc.origins).reduce((s, x) => s + x.cards.length, 0);
md.push('', `**Cards:** ${totalCards} · calls ${stats.calls} · retries ${stats.retries} · failed calls (after retries) ${stats.failedCalls} · ${Math.round((Date.now() - startedAt) / 1000)} s`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(doc, null, 1));
writeFileSync(join(dirname(OUT), 'history-entry.json'), JSON.stringify(historyEntry, null, 1));
writeFileSync(join(dirname(OUT), 'collect.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
