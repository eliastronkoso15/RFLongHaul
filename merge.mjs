// Merge per-origin collector outputs (one GitHub Actions job per origin) into one publishable set.
//
//   node merge.mjs <parts-dir> <data-dir> <out-dir>
//
// parts-dir/part-XXX/{v2/feed.json, v2/list-XXX.json, names.json, history-entry.json, cache/legs-XXX.json}
// An origin whose job produced nothing keeps its previously published entry and list
// (from data-dir/v2) — it goes stale on its own and the site hides it after 48 h,
// while the other origins stay fresh.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { ORIGINS } from './config.mjs';

const [partsDir, dataDir, outDir] = process.argv.slice(2);
const read = p => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
mkdirSync(join(outDir, 'v2'), { recursive: true });
mkdirSync(join(outDir, 'cache'), { recursive: true });

const parts = existsSync(partsDir) ? readdirSync(partsDir).map(d => join(partsDir, d)).filter(d => existsSync(join(d, 'v2/feed.json'))) : [];
const previous = read(join(dataDir, 'v2/feed.json'));
const feed = { schemaVersion: 2, generatedAt: null, source: 'google-flights-rpc', months: [], regions: [], origins: {}, stats: {} };
const names = read(join(dataDir, 'names.json')) ?? {};
const history = { v: 2, date: new Date().toISOString().slice(0, 10), origins: {} };
const fresh = new Set();

for (const dir of parts) {
  const f = read(join(dir, 'v2/feed.json'));
  for (const [o, info] of Object.entries(f.origins ?? {})) {
    feed.origins[o] = info;
    fresh.add(o);
    copyFileSync(join(dir, `v2/list-${o}.json`), join(outDir, `v2/list-${o}.json`));
    // Itinerary cache: only fresh origins replace theirs; others keep the one in the data branch.
    if (existsSync(join(dir, `cache/legs-${o}.json`))) copyFileSync(join(dir, `cache/legs-${o}.json`), join(outDir, `cache/legs-${o}.json`));
    feed.stats[o] = f.stats;
  }
  feed.months = [...new Set([...feed.months, ...(f.months ?? [])])].sort();
  feed.regions = [...new Set([...feed.regions, ...(f.regions ?? [])])];
  if (!feed.generatedAt || f.generatedAt > feed.generatedAt) feed.generatedAt = f.generatedAt;
  for (const [iata, n] of Object.entries(read(join(dir, 'names.json')) ?? {})) {
    names[iata] = { ...names[iata], ...n, city: { ...names[iata]?.city, ...n.city }, country: { ...names[iata]?.country, ...n.country } };
  }
  Object.assign(history.origins, read(join(dir, 'history-entry.json'))?.origins ?? {});
}

// Origins without a fresh part: carry the last published entry and list over, unchanged.
for (const o of Object.keys(ORIGINS)) {
  if (fresh.has(o) || !previous?.origins?.[o]) continue;
  const listPath = join(dataDir, `v2/list-${o}.json`);
  if (!existsSync(listPath)) continue;
  feed.origins[o] = { ...previous.origins[o], carriedOver: true };
  copyFileSync(listPath, join(outDir, `v2/list-${o}.json`));
}

writeFileSync(join(outDir, 'v2/feed.json'), JSON.stringify(feed, null, 1));
writeFileSync(join(outDir, 'names.json'), JSON.stringify(names, null, 1));
writeFileSync(join(outDir, 'history-entry.json'), JSON.stringify(history));
console.log(`merged: fresh ${[...fresh].join(', ') || 'none'} · carried over ${Object.keys(feed.origins).filter(o => !fresh.has(o)).join(', ') || 'none'}`);
if (!fresh.size) process.exit(1);
