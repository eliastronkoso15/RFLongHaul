// Probe: does plain-HTTPS access to Google Flights' Explore + Calendar RPCs work from this machine?
// Runs 2 Explore calls (SKG, ATH -> Asia) and 18 calendar calls (6-month window), sequentially.
// Writes out/results.json + out/summary.md (and the GitHub job summary when on Actions).
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { callRpc, calendarReq, exploreReq } from '../rpc.mjs';
import { calendarRows, exploreRows } from '../parse.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const isBlocked = t => /sorry\/index|captcha|unusual traffic/i.test(t || '');

const today = new Date().toISOString().slice(0, 10);
const WIN_FROM = addDays(today, 11);
const WIN_TO = addDays(WIN_FROM, 180);
const DESTS = ['PVG', 'CAN', 'HKG', 'BKK', 'HND', 'ICN', 'SIN', 'PEK'];
const ORIGINS = { SKG: '/m/0b2mc', ATH: '/m/0n2z' };
const ASIA = '/m/0j0k';

const results = { startedAt: new Date().toISOString(), host: process.env.GITHUB_ACTIONS ? 'github-actions' : 'local', explore: [], calendar: [] };
const lines = [];
const say = s => { console.log(s); lines.push(s); };

say(`# Long-haul RPC probe — ${results.host} — ${results.startedAt}`);
say('');
say('## Explore (→ Asia, default "1 week in the next 6 months")');
say('| Origin | HTTP | ms | Priced destinations | Cheapest 5 | Blocked |');
say('|---|---|---|---|---|---|');
for (const [iata, mid] of Object.entries(ORIGINS)) {
  let r, rows = [];
  try { r = await callRpc('GetExploreDestinations', exploreReq({ origin: [mid, 4], region: [ASIA, 6] })); rows = exploreRows(r.payloads); }
  catch (e) { r = { status: 'ERR ' + e.message, ms: 0, text: '' }; }
  const top = rows.slice(0, 5).map(x => `${x.city} €${x.price}`).join(', ');
  results.explore.push({ origin: iata, status: r.status, ms: r.ms, priced: rows.length, top: rows.slice(0, 15), blocked: isBlocked(r.text) });
  say(`| ${iata} | ${r.status} | ${r.ms} | ${rows.length} | ${top} | ${isBlocked(r.text) ? 'YES' : 'no'} |`);
  await sleep(3000);
}

say('');
say(`## Calendar (round trip, window ${WIN_FROM} … ${WIN_TO}, one call per row)`);
say('| # | Route | Nights | HTTP | ms | Days priced | Min € | Min date | Blocked |');
say('|---|---|---|---|---|---|---|---|---|');
const jobs = [];
for (const o of Object.keys(ORIGINS)) for (const d of DESTS) jobs.push({ o, d, n: 7 });
jobs.push({ o: 'SKG', d: 'PVG', n: 10 }, { o: 'SKG', d: 'PVG', n: 21 });
for (const [i, j] of jobs.entries()) {
  if (i) await sleep(2000);
  let r, rows = [];
  try {
    r = await callRpc('GetCalendarPicker', calendarReq({ origin: j.o, dest: j.d, out: WIN_FROM, back: addDays(WIN_FROM, j.n), winFrom: WIN_FROM, winTo: WIN_TO, minN: j.n, maxN: j.n }));
    rows = calendarRows(r.payloads);
  } catch (e) { r = { status: 'ERR ' + e.message, ms: 0, text: '' }; }
  const priced = rows.filter(x => x.price);
  const best = [...priced].sort((a, b) => a.price - b.price)[0];
  const blocked = isBlocked(r.text);
  results.calendar.push({ ...j, status: r.status, ms: r.ms, rows: rows.length, priced: priced.length, best, blocked });
  say(`| ${i + 1} | ${j.o}-${j.d} | ${j.n} | ${r.status} | ${r.ms} | ${priced.length}/${rows.length} | ${best?.price ?? '—'} | ${best?.out ?? '—'} | ${blocked ? 'YES' : 'no'} |`);
}

const all = [...results.explore, ...results.calendar];
const ok = all.filter(x => x.status === 200 && !x.blocked && (x.priced ?? 0) > 0).length;
results.finishedAt = new Date().toISOString();
results.verdict = { calls: all.length, okWithData: ok, blocked: all.filter(x => x.blocked).length, non200: all.filter(x => x.status !== 200).length };
say('');
say(`**Verdict:** ${ok}/${all.length} calls returned HTTP 200 with data · blocked ${results.verdict.blocked} · non-200 ${results.verdict.non200}`);

mkdirSync('out', { recursive: true });
writeFileSync('out/results.json', JSON.stringify(results, null, 1));
writeFileSync('out/summary.md', lines.join('\n') + '\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
if (ok === 0) process.exit(1);
