// Our own "usual price", built from the daily history files on the `data` branch (history2/).
// Each day stores, per origin, the cheapest price per (type, departure month, destination).
// The norm is the median of those daily prices over the last 30 days.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const NORM = { days: 30, minSamples: 7, dealRatio: 0.92 };

export const historyKey = (type, month, iata) => `${type}|${month}|${iata}`;

export function loadHistory(dir, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!dir || !existsSync(dir)) return [];
  const cutoff = new Date(Date.parse(today) - NORM.days * 864e5).toISOString().slice(0, 10);
  return readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) >= cutoff && f.slice(0, 10) < today)
    .sort()
    .map(f => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } })
    .filter(h => h?.v === 2);
}

const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

/** { median, samples } for one key, or null without history. */
export function normFor(history, origin, key) {
  const prices = history.map(h => h.origins?.[origin]?.[key]).filter(Number.isFinite);
  return prices.length ? { median: median(prices), samples: prices.length } : null;
}

/** "Below usual" only once there is enough history; otherwise null (no badge on the site). */
export function dealFor(price, norm) {
  if (!norm || norm.samples < NORM.minSamples || price > norm.median * NORM.dealRatio) return null;
  return { kind: 'low', amount: Math.round(norm.median - price), usual: norm.median, samples: norm.samples };
}
