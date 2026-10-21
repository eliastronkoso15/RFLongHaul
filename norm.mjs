// Our own "usual price" per route, built from the daily history files on the `data` branch.
// Each history file stores, per route, the card price of that day and the calendar floor per
// departure month and trip length. The norm is the median card price over the last 30 days.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const NORM = { days: 30, minSamples: 7, dealRatio: 0.92 };

export function loadHistory(dir, { today = new Date().toISOString().slice(0, 10), days = 60 } = {}) {
  if (!dir || !existsSync(dir)) return [];
  const cutoff = new Date(Date.parse(today) - days * 864e5).toISOString().slice(0, 10);
  return readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => f.slice(0, 10))
    .filter(d => d >= cutoff && d < today)
    .sort()
    .map(d => { try { return JSON.parse(readFileSync(join(dir, `${d}.json`), 'utf8')); } catch { return null; } })
    .filter(Boolean);
}

const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

/** { median, samples } for a route from history, or null when there is no history. */
export function routeNorm(history, routeKey, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const cutoff = new Date(Date.parse(today) - NORM.days * 864e5).toISOString().slice(0, 10);
  const prices = history.filter(h => h.date >= cutoff).map(h => h.routes?.[routeKey]?.cardPrice).filter(p => Number.isFinite(p));
  return prices.length ? { median: median(prices), samples: prices.length, days: NORM.days } : null;
}

/** A "below usual" deal only once there is enough history; otherwise null (the site shows no badge). */
export function dealFor(price, norm) {
  if (!norm || norm.samples < NORM.minSamples) return null;
  if (price > norm.median * NORM.dealRatio) return null;
  return { kind: 'low', amount: Math.round(norm.median - price), basis: `median of ${norm.samples} daily checks, ${norm.days} days` };
}
