// Gate before publishing (schema v2): drop malformed hero cards and list rows,
// and refuse to publish when the result is broken or near-empty. A refused run
// never replaces the published files — the site keeps the last good ones and
// hides the long-haul blocks by itself once they are too old.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PRICE_CAP } from './config.mjs';

export const MIN_ROWS = 20;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

function legOk(l) {
  return l && HHMM.test(l.dep ?? '') && HHMM.test(l.arr ?? '') && l.durationMin >= 60 && l.durationMin <= 3000 && Array.isArray(l.flights);
}

export function heroIssues(c, today) {
  const e = [];
  if (!/^[A-Z]{3}$/.test(c?.dest ?? '')) e.push('dest');
  if (!c?.city?.en) e.push('city');
  if (!(c?.price >= 50 && c.price <= 10000) || !/^[A-Z]{3}$/.test(c.currency ?? '')) e.push(`price ${c?.price} ${c?.currency}`);
  else if (c.price > (PRICE_CAP[c.currency] ?? PRICE_CAP.EUR)[c.type]) e.push(`price ${c.price} ${c.currency} over cap`);
  if (!DAY.test(c?.out ?? '') || c.out < today) e.push('out');
  if (c?.type === 'rt' && (!DAY.test(c.back ?? '') || c.back <= c.out)) e.push('back');
  if (!legOk(c?.outbound)) e.push('outbound');
  if (c?.inbound != null && !legOk(c.inbound)) e.push('inbound');
  if (!String(c?.url ?? '').startsWith('https://www.google.com/travel/flights')) e.push('url');
  return e;
}

export function rowOk(r, names, today, currency = 'EUR') {
  const cap = PRICE_CAP[currency] ?? PRICE_CAP.EUR;
  return r && (r.t === 'rt' || r.t === 'ow') && /^\d{4}-\d{2}$/.test(r.m ?? '') && names[r.d]?.city?.en
    && r.p >= 30 && r.p <= cap[r.t] && DAY.test(r.o ?? '') && r.o >= today
    && (r.t === 'ow' || (DAY.test(r.b ?? '') && r.b > r.o)) && Number.isInteger(r.s);
}

export function validate(outDir, { now = Date.now() } = {}) {
  const errors = [];
  const today = new Date(now).toISOString().slice(0, 10);
  const feed = JSON.parse(readFileSync(join(outDir, 'v2/feed.json'), 'utf8'));
  if (feed.schemaVersion !== 2) errors.push(`feed schemaVersion ${feed.schemaVersion}`);
  if (!(Math.abs(now - Date.parse(feed.generatedAt)) < 4 * 3600e3)) errors.push('feed generatedAt not fresh');
  let publishable = 0;
  for (const [o, info] of Object.entries(feed.origins ?? {})) {
    for (const k of ['rt', 'ow']) {
      const c = info.hero?.[k];
      if (c && heroIssues(c, today).length) { errors.push(`${o} hero ${k}: ${heroIssues(c, today).join(', ')}`); info.hero[k] = null; }
    }
    const listPath = join(outDir, `v2/list-${o}.json`);
    if (!existsSync(listPath)) { info.list = false; continue; }
    if (info.carriedOver) { publishable++; continue; }   // last good list, published before; ages out on its own
    const list = JSON.parse(readFileSync(listPath, 'utf8'));
    const before = list.rows.length;
    list.rows = list.rows.filter(r => rowOk(r, list.names, today, list.currency));
    if (list.rows.length < before) errors.push(`${o} list: dropped ${before - list.rows.length} malformed or over-cap rows`);
    info.list = list.rows.length >= MIN_ROWS;
    info.rowCount = list.rows.length;
    if (info.list) { publishable++; writeFileSync(listPath, JSON.stringify(list)); }
    else errors.push(`${o} list: only ${list.rows.length} rows (min ${MIN_ROWS}) — not published for this origin`);
  }
  const fatal = errors.some(e => e.startsWith('feed '));
  const ok = !fatal && publishable > 0;
  if (ok) writeFileSync(join(outDir, 'v2/feed.json'), JSON.stringify(feed, null, 1));
  return { ok, publishable, errors };
}

// CLI: node validate.mjs out   → exit 1 if nothing is publishable.
if (import.meta.url === `file://${process.argv[1]}`) {
  const res = validate(process.argv[2] ?? 'out');
  for (const e of res.errors) console.log(`  note: ${e}`);
  console.log(`publishable origins: ${res.publishable} → ${res.ok ? 'PUBLISH' : 'DO NOT PUBLISH'}`);
  process.exit(res.ok ? 0 : 1);
}
