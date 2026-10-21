// Spike 1b: itinerary details + a mini end-to-end pipeline.
//   A. Explore trip-length codes ([] vs [0,1] vs [0,2] vs [0,3]).
//   B. Stops filter code on GetShoppingResults (0 / 1 / 2).
//   C. Pipeline: calendar (6 months) -> 3 cheapest spaced dates -> itineraries -> quality filter.
//      Writes out/longhaul.json (draft schema v0) + out/pipeline.md (+ GitHub job summary).
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { callRpc, calendarReq, exploreReq, shoppingReq } from './rpc.mjs';
import { calendarRows, exploreRows, shoppingRows } from './parse.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const nightsOf = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const fmtDur = m => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
const lines = [];
const say = s => { console.log(s); lines.push(s); };
let calls = 0, failed = 0;
async function rpc(name, req) {
  if (calls++) await sleep(2000);
  try { const r = await callRpc(name, req); if (r.status !== 200 || r.errorCode) failed++; return r; }
  catch (e) { failed++; return { status: 'ERR ' + e.message, ms: 0, payloads: [], text: '' }; }
}

// Quality rules for a card: at most 1 stop, layover 1–6 h, no airport change, door-to-door ≤ 22 h.
const QUALITY = { maxStops: 1, minLayover: 60, maxLayover: 360, maxDurationMin: 22 * 60 };
function qualityIssues(it) {
  const why = [];
  if (it.stops > QUALITY.maxStops) why.push(`${it.stops} stops`);
  for (const l of it.layovers) {
    if (l.minutes > QUALITY.maxLayover) why.push(`layover ${fmtDur(l.minutes)} ${l.airport}`);
    if (l.minutes < QUALITY.minLayover) why.push(`tight layover ${l.minutes}m ${l.airport}`);
    if (l.changeAirport) why.push(`airport change at ${l.airport}`);
  }
  if (it.durationMin > QUALITY.maxDurationMin) why.push(`total ${fmtDur(it.durationMin)}`);
  return why;
}

say(`# Spike 1b — ${process.env.GITHUB_ACTIONS ? 'github-actions' : 'local'} — ${new Date().toISOString()}`);

// ── A. Explore trip-length codes ────────────────────────────────────────────
say('\n## A. Explore SKG → Asia: trip-length code');
say('| flex | HTTP | priced | median nights | nights seen | cheapest 3 |');
say('|---|---|---|---|---|---|');
for (const flex of [[], [0, 1], [0, 2], [0, 3]]) {
  const r = await rpc('GetExploreDestinations', exploreReq({ origin: ['/m/0b2mc', 4], region: ['/m/0j0k', 6], flex }));
  const rows = exploreRows(r.payloads);
  const n = rows.filter(x => x.out && x.back).map(x => nightsOf(x.out, x.back));
  say(`| ${JSON.stringify(flex)} | ${r.status} | ${rows.length} | ${median(n) ?? '—'} | ${[...new Set(n)].sort((a, b) => a - b).join(',')} | ${rows.slice(0, 3).map(x => `${x.city} €${x.price}`).join(', ')} |`);
}

// ── B. Stops filter code ────────────────────────────────────────────────────
say('\n## B. GetShoppingResults SKG-PVG 2027-01-16 → 01-23: stops code');
say('| stopsCode | HTTP | itineraries | max stops | cheapest |');
say('|---|---|---|---|---|');
for (const stopsCode of [0, 1, 2]) {
  const r = await rpc('GetShoppingResults', shoppingReq({ origin: 'SKG', dest: 'PVG', out: '2027-01-16', back: '2027-01-23', stopsCode }));
  const rows = shoppingRows(r.payloads);
  say(`| ${stopsCode} | ${r.status} | ${rows.length} | ${rows.length ? Math.max(...rows.map(x => x.stops)) : '—'} | ${rows[0] ? `€${rows[0].price} ${rows[0].airlines.join('+')} ${rows[0].stops} stop` : '—'} |`);
}

// ── C. Pipeline ─────────────────────────────────────────────────────────────
const NIGHTS = 7;
const WIN_FROM = addDays(new Date().toISOString().slice(0, 10), 11);
const WIN_TO = addDays(WIN_FROM, 180);
const ROUTES = [['SKG', 'PVG'], ['SKG', 'CAN'], ['SKG', 'BKK'], ['ATH', 'BKK'], ['ATH', 'ICN'], ['ATH', 'SIN']];
const cards = [];
say(`\n## C. Pipeline (${NIGHTS} nights, ${WIN_FROM} … ${WIN_TO})`);
say('| Route | Calendar min | Date | Cheapest itinerary | Best passing quality | Rejected cheaper because |');
say('|---|---|---|---|---|---|');
for (const [o, d] of ROUTES) {
  const cal = calendarRows((await rpc('GetCalendarPicker', calendarReq({ origin: o, dest: d, out: WIN_FROM, back: addDays(WIN_FROM, NIGHTS), winFrom: WIN_FROM, winTo: WIN_TO, minN: NIGHTS, maxN: NIGHTS }))).payloads)
    .filter(x => x.price).sort((a, b) => a.price - b.price || a.out.localeCompare(b.out));
  // 3 cheapest dates at least 7 days apart, so we don't sample the same week three times.
  const picks = [];
  for (const c of cal) { if (picks.every(p => Math.abs(nightsOf(p.out, c.out)) >= 7)) picks.push(c); if (picks.length === 3) break; }
  let bestQ = null, cheapest = null; const rejected = []; const errors = [];
  for (const p of picks) {
    const sr = await rpc('GetShoppingResults', shoppingReq({ origin: o, dest: d, out: p.out, back: p.back }));
    if (sr.errorCode) errors.push(sr.errorCode);
    const its = shoppingRows(sr.payloads);
    for (const it of its) {
      const cand = { ...it, out: p.out, back: p.back, calendarPrice: p.price };
      if (!cheapest || cand.price < cheapest.price) cheapest = cand;
      const why = qualityIssues(it);
      if (why.length) { if (!bestQ || it.price < bestQ.price) rejected.push(`€${it.price}: ${why.join('; ')}`); continue; }
      if (!bestQ || cand.price < bestQ.price) bestQ = cand;
    }
  }
  const desc = x => x ? `€${x.price} ${x.airlines.join('+')} · ${x.stops ? x.layovers.map(l => `${l.airport} ${fmtDur(l.minutes)}`).join(', ') : 'nonstop'} · ${fmtDur(x.durationMin)} · ${x.flights.join(' ')} · ${x.out}→${x.back}` : '—';
  const cheaperRejected = [...new Set(rejected.filter(r => bestQ && Number(r.slice(1, r.indexOf(':'))) < bestQ.price))].slice(0, 2).join(' / ');
  const errNote = errors.length ? ` (Google error ${[...new Set(errors)].join(',')} on ${errors.length}/${picks.length} dates${bestQ || cheapest ? '' : ' — route skipped'})` : '';
  say(`| ${o}-${d} | €${cal[0]?.price ?? '—'} | ${cal[0]?.out ?? '—'} | ${desc(cheapest)}${errNote} | ${desc(bestQ)} | ${cheaperRejected || '—'} |`);
  if (bestQ) cards.push({
    origin: o, dest: d, price: bestQ.price, currency: 'EUR', out: bestQ.out, back: bestQ.back, nights: NIGHTS,
    airlines: bestQ.airlines, airlineCode: bestQ.airlineCode, stops: bestQ.stops,
    outbound: { dep: bestQ.dep, arr: bestQ.arr, arrDate: bestQ.arrDate, durationMin: bestQ.durationMin, flights: bestQ.flights, layovers: bestQ.layovers },
    calendarMin: cal[0]?.price ?? null, checkedAt: new Date().toISOString(),
  });
}

const doc = { schemaVersion: 0, generatedAt: new Date().toISOString(), source: 'google-flights-rpc', quality: QUALITY, cards };
say(`\n**Calls:** ${calls}, failed ${failed}. **Cards:** ${cards.length}/${ROUTES.length}.`);
mkdirSync('out', { recursive: true });
writeFileSync('out/longhaul.json', JSON.stringify(doc, null, 1));
writeFileSync('out/pipeline.md', lines.join('\n') + '\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
if (failed === calls) process.exit(1);
