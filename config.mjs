// What we collect, and what counts as a sensible long-haul itinerary.

/** Origins: IATA → Freebase MID used by Explore. Coordinates live in geo.mjs. */
export const ORIGINS = {
  SKG: { mid: '/m/0b2mc' },
  ATH: { mid: '/m/0n2z' },
};

/** Explore regions (Freebase MIDs). Europe is never queried; Asia includes the Middle East, filtered by distance. */
export const REGIONS = {
  asia: ['/m/0j0k', 6],
  northAmerica: ['/m/059g4', 6],
  southAmerica: ['/m/06n3y', 6],
  africa: ['/m/0dg3n1', 6],
  oceania: ['/m/05nrg', 6],
};

/** Months requested from Explore: this month + the next MONTHS_AHEAD (Explore offers ~6). */
export const MONTHS_AHEAD = 6;

/** List kinds: round trips of ~1 week (6–9 nights) and ~2 weeks (13–16 nights), plus one-way. */
export const KINDS = [
  { type: 'rt', length: 'week', tripType: 1, lengthCode: 2 },
  { type: 'rt', length: 'twoWeeks', tripType: 1, lengthCode: 3 },
  { type: 'ow', length: null, tripType: 2, lengthCode: 2 },
];

/** Long-haul = at least this far from the origin, and not in Europe. */
export const LONG_HAUL_MIN_KM = 4000;

/** Explore rows kept in the list: at most 2 stops and ≤ 30 h one way (the UI filters further). */
export const LIST_LIMITS = { maxStops: 2, maxDurationMin: 30 * 60 };

/** Hero cards: an itinerary must be ≤ 1 stop, layovers 1–6 h, no airport change, ≤ 22 h each way. */
export const QUALITY = { maxStops: 1, minLayover: 60, maxLayover: 360, maxDurationMin: 22 * 60 };
export const HERO_CANDIDATES = 4;

/** Carriers shown with the "low-cost" tag. */
export const LOW_COST = new Set(['G9', 'TR', 'FZ', 'W6', 'PC', 'VF', '6E', 'AK', 'D7', 'VJ', 'XY', 'J9', 'F3', 'JQ']);

/** Concurrent Explore calls per origin, and the pause each worker takes between calls. */
export const CONCURRENCY = 2;
export const GAP_MS = 1500;

/** Google's official names that read badly on a card; replaced by IATA. */
export const NAME_FIXES = {
  KUL: { en: 'Kuala Lumpur', ru: 'Куала-Лумпур', el: 'Κουάλα Λουμπούρ' },
  TPE: { en: 'Taipei', ru: 'Тайбэй', el: 'Ταϊπέι' },
  DPS: { en: 'Bali', ru: 'Бали', el: 'Μπαλί' },
};
