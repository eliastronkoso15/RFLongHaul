// Gate before publishing: drop malformed cards, refuse to publish a doc that is broken or empty.
// A refused doc never replaces the published one — the site keeps the last good file
// (and hides the block by itself once that file is too old).
import { readFileSync, writeFileSync } from 'node:fs';

export const MIN_CARDS = 3;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

function legIssues(leg, label) {
  const e = [];
  if (!leg || typeof leg !== 'object') return [`${label} missing`];
  if (!HHMM.test(leg.dep ?? '') || !HHMM.test(leg.arr ?? '')) e.push(`${label} times`);
  if (!(leg.durationMin >= 60 && leg.durationMin <= 3000)) e.push(`${label} duration ${leg.durationMin}`);
  if (!Array.isArray(leg.flights) || leg.flights.some(f => typeof f !== 'string')) e.push(`${label} flights`);
  return e;
}

export function cardIssues(c, today) {
  const e = [];
  if (!/^[A-Z]{3}$/.test(c.dest ?? '')) e.push('dest');
  if (!c.city || !c.cc) e.push('city/cc');
  if (!(Number.isFinite(c.price) && c.price >= 50 && c.price <= 10000)) e.push(`price ${c.price}`);
  if (c.currency !== 'EUR') e.push('currency');
  if (!ISO_DAY.test(c.out ?? '') || !ISO_DAY.test(c.back ?? '')) e.push('dates');
  else {
    if (c.out < today) e.push('out in the past');
    const n = Math.round((Date.parse(c.back) - Date.parse(c.out)) / 864e5);
    if (n !== c.nights || n < 1 || n > 60) e.push(`nights ${c.nights}/${n}`);
  }
  if (typeof c.airline !== 'string' || !c.airline) e.push('airline');
  e.push(...legIssues(c.outbound, 'outbound'));
  if (c.inbound != null) e.push(...legIssues(c.inbound, 'inbound'));
  if (!String(c.url ?? '').startsWith('https://www.google.com/travel/flights')) e.push('url');
  return e;
}

export function validateDoc(doc, { now = Date.now() } = {}) {
  const errors = [];
  if (doc?.schemaVersion !== 1) errors.push(`schemaVersion ${doc?.schemaVersion}`);
  const gen = Date.parse(doc?.generatedAt ?? '');
  if (!Number.isFinite(gen) || Math.abs(now - gen) > 3 * 3600e3) errors.push('generatedAt not fresh');
  const today = new Date(now).toISOString().slice(0, 10);
  let total = 0;
  const cleaned = { ...doc, origins: {} };
  for (const [iata, o] of Object.entries(doc?.origins ?? {})) {
    if (!/^[A-Z]{3}$/.test(iata)) { errors.push(`origin key ${iata}`); continue; }
    const cards = [];
    for (const c of o.cards ?? []) {
      const issues = cardIssues(c, today);
      if (issues.length) errors.push(`${iata}-${c?.dest}: ${issues.join(', ')}`); else cards.push(c);
    }
    total += cards.length;
    cleaned.origins[iata] = { ...o, cards };
  }
  const ok = !errors.some(e => e.startsWith('schemaVersion') || e.startsWith('generatedAt')) && total >= MIN_CARDS;
  return { ok, total, errors, doc: cleaned };
}

// CLI: node validate.mjs out/longhaul.json  → rewrites the file with only valid cards; exit 1 if not publishable.
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ?? 'out/longhaul.json';
  const res = validateDoc(JSON.parse(readFileSync(path, 'utf8')));
  for (const e of res.errors) console.log(`  dropped/err: ${e}`);
  console.log(`valid cards: ${res.total} (min ${MIN_CARDS}) → ${res.ok ? 'PUBLISH' : 'DO NOT PUBLISH'}`);
  if (res.ok) writeFileSync(path, JSON.stringify(res.doc, null, 1));
  process.exit(res.ok ? 0 : 1);
}
