// Probe: why do round-trip searches from Thessaloniki fail (slow error 13, ~20 s)?
// Each SKG route that failed in the 2026-10-22 run (spikes/failed-skg-2026-10-22.json) gets
// the outbound search three ways:
//   A  as the collector does it now: any number of stops, "Cheapest" tab;
//   B  at most 1 stop (leg stops code 2) — the site only shows ≤ 1 stop by default;
//   C  "Best" tab instead of "Cheapest".
// The order of A/B/C rotates per route so time of day doesn't favour one. Two lanes, 1.5 s gap.
// Writes out/variants.json + out/variants.md (and the GitHub job summary).
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { callRpc, shoppingReq } from '../rpc.mjs';
import { shoppingRows } from '../parse.mjs';

const ROUTES = JSON.parse(readFileSync(new URL('./failed-skg-2026-10-22.json', import.meta.url), 'utf8'));
const ORIGIN = ['/m/0b2mc', 4];   // Thessaloniki, as the collector asks
const POS = { gl: 'GR', curr: 'EUR' };
const VARIANTS = { A: { stopsCode: 0, sort: 2 }, B: { stopsCode: 2, sort: 2 }, C: { stopsCode: 0, sort: 1 } };
const INSTANT_MS = 3000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = m => (m ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : '—');

const jobs = ROUTES.flatMap((r, i) => ['A', 'B', 'C'].map((_, k) => ({ ...r, v: 'ABC'[(i + k) % 3] })));
const results = [];
let next = 0;
await Promise.all([0, 1].map(async () => {
  let first = true;
  while (next < jobs.length) {
    const j = jobs[next++];
    if (!first) await sleep(1500);
    first = false;
    const t0 = Date.now();
    let res;
    try { res = await callRpc('GetShoppingResults', shoppingReq({ origin: ORIGIN, dest: j.dest, out: j.out, back: j.back, ...VARIANTS[j.v] }), POS); }
    catch (e) { res = { status: 'ERR', errorCode: null, payloads: [], error: e.message }; }
    const ms = Date.now() - t0;
    const failed = res.status !== 200 || !!res.errorCode;
    const rows = failed ? [] : shoppingRows(res.payloads);
    const it = rows[0];
    const outcome = it ? 'ok' : !failed ? 'empty' : ms < INSTANT_MS ? 'instant' : 'slow';
    results.push({ ...j, outcome, ms, err: res.errorCode ?? null, status: res.status, n: rows.length,
      price: it?.price ?? null, stops: it?.stops ?? null, du: it?.durationMin ?? null, airlines: it?.airlines?.join(' + ') ?? null });
    console.log(`${j.v} SKG→${j.dest} ${j.out}/${j.back} ${outcome} ${ms}ms${res.errorCode ? ` err${res.errorCode}` : ''}${it ? ` €${it.price} ${it.stops}st ${fmt(it.durationMin)} ${rows.length} rows` : ''}`);
  }
}));

const lines = [`# Verify variants — SKG round trips that failed on 2026-10-22 (${process.env.GITHUB_ACTIONS ? 'github-actions' : 'local'}, ${new Date().toISOString()})`, ''];
lines.push('| Variant | ok | empty | slow | instant | avg ms |', '|---|---|---|---|---|---|');
for (const v of ['A', 'B', 'C']) {
  const rs = results.filter(r => r.v === v);
  const c = k => rs.filter(r => r.outcome === k).length;
  lines.push(`| ${v} ${JSON.stringify(VARIANTS[v])} | ${c('ok')} | ${c('empty')} | ${c('slow')} | ${c('instant')} | ${Math.round(rs.reduce((s, r) => s + r.ms, 0) / rs.length)} |`);
}
lines.push('', '| Route | A | B (≤1 stop) | C (Best) |', '|---|---|---|---|');
const cell = r => (r ? (r.outcome === 'ok' ? `€${r.price} · ${r.stops} st · ${fmt(r.du)} · ${Math.round(r.ms / 1000)} s` : `${r.outcome} ${Math.round(r.ms / 1000)} s`) : '');
for (const rt of ROUTES) {
  const by = v => results.find(r => r.dest === rt.dest && r.v === v);
  lines.push(`| ${rt.dest} ${rt.out}/${rt.back} | ${cell(by('A'))} | ${cell(by('B'))} | ${cell(by('C'))} |`);
}
mkdirSync('out', { recursive: true });
writeFileSync('out/variants.json', JSON.stringify(results, null, 1));
writeFileSync('out/variants.md', lines.join('\n') + '\n');
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
