// Daily long-haul collector, schema v2.
//   List: Explore × regions × months × (round trip ~1 week, ~2 weeks, one-way) — long-haul only.
//   Hero: the most "far for little" round trip and one-way per origin, verified with real itineraries.
//   Names: city/country in en/ru/el straight from Google (cached in names.json).
//
//   node collect.mjs [--out out] [--data data] [--origins SKG,ATH] [--months 7] [--regions asia,africa]
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { callRpcRetry, exploreReq, shoppingReq, shoppingOwReq, inboundReq } from './rpc.mjs';
import { exploreRows, exploreNames, shoppingRows } from './parse.mjs';
import { ORIGINS, REGIONS, MONTHS_AHEAD, KINDS, LONG_HAUL_MIN_KM, LIST_LIMITS, QUALITY, HERO_CANDIDATES, LOW_COST, CONCURRENCY, GAP_MS, NAME_FIXES } from './config.mjs';
import { ORIGIN_COORDS, EUROPE, haversineKm, countryCode } from './geo.mjs';
import { flightsUrl } from './tfs.mjs';
import { loadHistory, normFor, dealFor, historyKey } from './norm.mjs';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const OUT = arg('out', 'out');
const DATA = arg('data', null);
const ONLY_ORIGINS = arg('origins', null)?.split(',');
const MONTH_COUNT = Number(arg('months', MONTHS_AHEAD + 1));
const ONLY_REGIONS = arg('regions', null)?.split(',');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtDur = m => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const startedAt = new Date();
const TODAY = startedAt.toISOString().slice(0, 10);
const stats = { calls: 0, retries: 0, failedCalls: 0, exploreFailed: 0 };

const RETRIES = { GetExploreDestinations: 1, GetShoppingResults: 1 };
async function rpc(name, req, lane, opts = {}) {
  if (lane.calls++) await sleep(GAP_MS);
  stats.calls++;
  const r = await callRpcRetry(name, req, { retries: RETRIES[name] ?? 1, backoffMs: [8_000], ...opts });
  stats.retries += (r.attempts ?? 1) - 1;
  if (r.status !== 200 || r.errorCode) stats.failedCalls++;
  return r;
}
const failed = r => r.status !== 200 || !!r.errorCode;

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    const lane = { calls: 0 };
    while (next < items.length) { const k = next++; out[k] = await fn(items[k], lane); }
  }));
  return out;
}

const origins = Object.entries(ORIGINS).filter(([o]) => !ONLY_ORIGINS || ONLY_ORIGINS.includes(o));
const regions = Object.keys(REGIONS).filter(r => !ONLY_REGIONS || ONLY_REGIONS.includes(r));
const months = Array.from({ length: MONTH_COUNT }, (_, i) => {
  const d = new Date(Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth() + i, 1));
  return { num: d.getUTCMonth() + 1, ym: d.toISOString().slice(0, 7) };
});

// ── 1. List ─────────────────────────────────────────────────────────────────
const meta = {};   // IATA → { mid, cityEn, countryEn, cc, region, km: { origin: km } }

function normalizeRow(o, kind, region, x) {
  if (!x.iata || !x.price || !x.out || x.lat == null) return null;
  const cc = countryCode(x.country);
  if (cc && EUROPE.has(cc)) return null;
  const km = haversineKm(ORIGIN_COORDS[o], [x.lat, x.lng]);
  if (km < LONG_HAUL_MIN_KM) return null;
  if (x.stops > LIST_LIMITS.maxStops || (x.durMin && x.durMin > LIST_LIMITS.maxDurationMin)) return null;
  if (kind.type === 'rt' && !x.back) return null;
  meta[x.iata] ??= { mid: x.mid, cityEn: x.city, countryEn: x.country, cc, region, km: {} };
  meta[x.iata].km[o] = km;
  return {
    t: kind.type, l: kind.length, m: x.out.slice(0, 7), d: x.iata, p: x.price, o: x.out,
    b: kind.type === 'rt' ? x.back : null, n: kind.type === 'rt' ? daysBetween(x.out, x.back) : null,
    s: x.stops, a: x.airline || '', du: x.durMin || null,
  };
}

async function collectList(o, mid) {
  const tasks = [];
  for (const month of months) for (const kind of KINDS) for (const region of regions) tasks.push({ month, kind, region });
  const results = await pool(tasks, CONCURRENCY, async ({ month, kind, region }, lane) => {
    const r = await rpc('GetExploreDestinations', exploreReq({ origin: [mid, 4], region: REGIONS[region], flex: [month.num, kind.lengthCode], tripType: kind.tripType }), lane);
    if (failed(r)) { stats.exploreFailed++; return []; }
    return exploreRows(r.payloads).map(x => normalizeRow(o, kind, region, x)).filter(Boolean);
  });
  const best = new Map();
  for (const row of results.flat()) {
    const key = `${row.t}|${row.l}|${row.m}|${row.d}`;
    if (!best.has(key) || row.p < best.get(key).p) best.set(key, row);
  }
  return [...best.values()].sort((a, b) => a.p - b.p);
}

// ── 2. Names (en from the list calls; ru/el from Google, cached) ────────────
const namesPath = DATA ? join(DATA, 'names.json') : null;
const names = namesPath && existsSync(namesPath) ? JSON.parse(readFileSync(namesPath, 'utf8')) : {};

async function harvestNames() {
  for (const [iata, m] of Object.entries(meta)) {
    names[iata] ??= { city: {}, country: {} };
    Object.assign(names[iata], { mid: m.mid, cc: m.cc, region: m.region });
    names[iata].city.en = m.cityEn;
    names[iata].country.en = m.countryEn;
  }
  const lane = { calls: 0 };
  for (const [hl, locale] of [['ru', 'ru-RU'], ['el', 'el-GR']]) {
    for (const region of regions) {
      for (const [, { mid }] of origins) {
        const missing = Object.entries(names).filter(([iata, n]) => meta[iata]?.region === region && !n.city[hl]);
        if (!missing.length) break;
        const r = await rpc('GetExploreDestinations', exploreReq({ origin: [mid, 4], region: REGIONS[region], flex: [0, 2] }), lane, { hl, locale });
        if (failed(r)) continue;
        const got = exploreNames(r.payloads);
        for (const [, n] of missing) {
          const g = got[n.mid];
          if (g) { n.city[hl] = g.city; n.country[hl] = g.country; }
        }
      }
    }
  }
  for (const [iata, fix] of Object.entries(NAME_FIXES)) if (names[iata]) Object.assign(names[iata].city, fix);
}

// ── 3. Hero cards ───────────────────────────────────────────────────────────
function qualityIssues(it) {
  const why = [];
  if (it.stops > QUALITY.maxStops) why.push(`${it.stops} stops`);
  for (const l of it.layovers) {
    if (l.minutes > QUALITY.maxLayover || l.minutes < QUALITY.minLayover) why.push(`layover ${fmtDur(l.minutes)} ${l.airport}`);
    if (l.changeAirport) why.push(`airport change ${l.airport}`);
  }
  if (it.durationMin > QUALITY.maxDurationMin) why.push(`total ${fmtDur(it.durationMin)}`);
  return why;
}
const legSummary = it => ({
  dep: it.dep, arr: it.arr, plusDays: it.plusDays, durationMin: it.durationMin,
  flights: it.flights.filter(Boolean), layovers: it.layovers.map(l => ({ airport: l.airport, minutes: l.minutes })),
});
const perThousandKm = (price, km) => price / (km / 1000);

async function heroFor(o, rows, type, history, { excludeDest = null } = {}) {
  const lane = { calls: 0 };
  const seen = new Set();
  const candidates = rows
    .filter(r => r.t === type && r.d !== excludeDest && r.s <= QUALITY.maxStops && r.du && r.du <= QUALITY.maxDurationMin)
    .sort((a, b) => perThousandKm(a.p, meta[a.d].km[o]) - perThousandKm(b.p, meta[b.d].km[o]))
    .filter(r => !seen.has(r.d) && seen.add(r.d))
    .slice(0, HERO_CANDIDATES);
  let best = null;
  for (const c of candidates) {
    const r = await rpc('GetShoppingResults', type === 'rt'
      ? shoppingReq({ origin: o, dest: c.d, out: c.o, back: c.b })
      : shoppingOwReq({ origin: o, dest: c.d, out: c.o }), lane);
    if (failed(r)) continue;
    const it = shoppingRows(r.payloads).find(x => !qualityIssues(x).length);
    if (!it) continue;
    let price = it.price, inbound = null;
    if (type === 'rt' && it.token) {
      const ir = await rpc('GetShoppingResults', inboundReq({ origin: o, dest: c.d, out: c.o, back: c.b, token: it.token, segments: it.segments }), lane);
      if (!failed(ir)) {
        const good = shoppingRows(ir.payloads).find(x => !qualityIssues(x).length);
        if (good) { inbound = good; price = good.price; }
      }
    }
    const km = meta[c.d].km[o];
    const score = perThousandKm(price, km);
    if (best && score >= best.score) continue;
    const codes = [...new Set([...it.segments, ...(inbound?.segments ?? [])].map(s => s.carrierCode).filter(Boolean))];
    const n = names[c.d] ?? {};
    best = {
      score,
      card: {
        type, dest: c.d, city: n.city ?? { en: meta[c.d].cityEn }, country: n.country ?? { en: meta[c.d].countryEn }, cc: n.cc ?? null,
        region: meta[c.d].region, km, price, currency: 'EUR', out: c.o, back: type === 'rt' ? c.b : null, nights: c.n,
        airline: it.airlines.join(' + '), airlineCodes: codes, lowCost: codes.length > 0 && codes.every(x => LOW_COST.has(x)),
        via: it.layovers[0]?.airport ?? null, stops: it.stops, outbound: legSummary(it), inbound: inbound ? legSummary(inbound) : null,
        url: flightsUrl({ origin: o, dest: c.d, out: c.o, back: type === 'rt' ? c.b : null }),
        deal: dealFor(price, normFor(history, o, historyKey(type, c.o.slice(0, 7), c.d))),
        checkedAt: new Date().toISOString(),
      },
    };
  }
  return best?.card ?? null;
}

// ── run ─────────────────────────────────────────────────────────────────────
const history = loadHistory(DATA ? join(DATA, 'history2') : null, { today: TODAY });
const lists = Object.fromEntries(await Promise.all(origins.map(async ([o, { mid }]) => [o, await collectList(o, mid)])));
await harvestNames();
// Two hero cards per origin, two different places: the one-way skips the round trip's destination.
const heroes = Object.fromEntries(await Promise.all(origins.map(async ([o]) => {
  const rt = await heroFor(o, lists[o], 'rt', history);
  const ow = await heroFor(o, lists[o], 'ow', history, { excludeDest: rt?.dest });
  return [o, { rt, ow }];
})));

const generatedAt = new Date().toISOString();
const feed = { schemaVersion: 2, generatedAt, source: 'google-flights-rpc', months: months.map(m => m.ym), regions, origins: {}, stats };
const historyEntry = { v: 2, date: TODAY, origins: {} };
const md = [`# Long-haul collect v2 — ${TODAY} (${process.env.GITHUB_ACTIONS ? 'github-actions' : 'local'})`, '',
  `Months ${months[0].ym} … ${months.at(-1).ym} · regions ${regions.join(', ')} · history days ${history.length}`, ''];
mkdirSync(join(OUT, 'v2'), { recursive: true });

for (const [o] of origins) {
  const rows = lists[o];
  const h = (historyEntry.origins[o] = {});
  for (const r of rows) {
    const key = historyKey(r.t, r.m, r.d);
    h[key] = Math.min(h[key] ?? Infinity, r.p);
    const deal = dealFor(r.p, normFor(history, o, key));
    if (deal) { r.dl = deal.amount; r.us = deal.usual; }
  }
  const usedNames = {};
  for (const r of rows) {
    const n = names[r.d];
    usedNames[r.d] = { city: n?.city ?? { en: meta[r.d].cityEn }, country: n?.country ?? { en: meta[r.d].countryEn }, cc: n?.cc ?? null, region: meta[r.d].region, km: meta[r.d].km[o] };
  }
  writeFileSync(join(OUT, `v2/list-${o}.json`), JSON.stringify({ schemaVersion: 2, generatedAt, origin: o, names: usedNames, rows }));
  feed.origins[o] = { hero: heroes[o], list: rows.length > 0, rowCount: rows.length };

  const rt = rows.filter(r => r.t === 'rt'), ow = rows.filter(r => r.t === 'ow');
  const dests = new Set(rows.map(r => r.d));
  md.push(`## ${o}: ${rows.length} rows (${rt.length} RT, ${ow.length} one-way), ${dests.size} destinations`, '');
  md.push(`- by region: ${regions.map(g => `${g} ${new Set(rows.filter(r => meta[r.d].region === g).map(r => r.d)).size}`).join(' · ')}`);
  md.push(`- months with rows: ${[...new Set(rows.map(r => r.m))].sort().join(', ')}`);
  for (const [k, c] of Object.entries(heroes[o])) {
    md.push(c
      ? `- **hero ${k}:** ${c.city.en} (${c.dest}) €${c.price} ${c.out}${c.back ? '→' + c.back : ''} · ${c.airline} · ${c.via ?? 'nonstop'} · ${fmtDur(c.outbound.durationMin)} · ${c.km} km → €${(c.price / (c.km / 1000)).toFixed(0)}/1000 km`
      : `- **hero ${k}:** none passed`);
  }
  const top = (type) => rows.filter(r => r.t === type && r.s <= 1).slice(0, 6).map(r => `${names[r.d]?.city?.en ?? r.d} €${r.p} (${r.o})`).join(' · ');
  md.push(`- cheapest ≤1-stop RT: ${top('rt')}`, `- cheapest ≤1-stop one-way: ${top('ow')}`, '');
}
const missingRu = Object.values(names).filter(n => !n.city?.ru).length;
md.push(`**Calls** ${stats.calls} · retries ${stats.retries} · failed ${stats.failedCalls} (Explore ${stats.exploreFailed}) · names without ru ${missingRu} · ${Math.round((Date.now() - startedAt) / 1000)} s`);

writeFileSync(join(OUT, 'v2/feed.json'), JSON.stringify(feed, null, 1));
writeFileSync(join(OUT, 'names.json'), JSON.stringify(names, null, 1));
writeFileSync(join(OUT, 'history-entry.json'), JSON.stringify(historyEntry));
writeFileSync(join(OUT, 'collect.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
