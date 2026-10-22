// What we collect, and what counts as a sensible long-haul itinerary.

/**
 * Origins. place = how Google is asked: a city MID ([mid, 4]) or an airport ([IATA, 0]).
 * gl/curr = point of sale and currency (prices and links use the same ones).
 * London is all London airports (most long-haul leaves from LHR/LGW, not STN);
 * its links use a text query, since the search-link protobuf only carries airports.
 */
export const ORIGINS = {
  SKG: { place: ['/m/0b2mc', 4], gl: 'GR', curr: 'EUR' },
  ATH: { place: ['/m/0n2z', 4], gl: 'GR', curr: 'EUR' },
  EVN: { place: ['EVN', 0], gl: 'AM', curr: 'EUR' },
  STN: { place: ['/m/04jpl', 4], gl: 'GB', curr: 'GBP', cityName: 'London' },
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

/**
 * Price ceilings per currency: Runaway Fly is about cheap fares, so a long-haul round trip
 * over €1000 or a one-way over €500 is not listed (GBP ≈ the same at ~0.85 £/€).
 * Applied to Explore rows, to verified (live) prices and to hero cards.
 */
export const PRICE_CAP = { EUR: { rt: 1000, ow: 500 }, GBP: { rt: 850, ow: 425 } };

/**
 * Rows the site shows by default (cheapest per destination × type × month, ≤ 1 stop, ≤ 24 h)
 * get real itineraries: both legs with layovers (and a live price). The site shows a round
 * trip only once both legs are known.
 *   - Order: first the topPerMonth best rows of each type × month (biggest dip, then cheapest),
 *     then the other shown rows, then the other trip lengths. Within each group: next month,
 *     this month, later; round trips before one-way.
 *   - Results are cached per (type, destination, dates) for cacheDays.
 *   - Failures are told apart:
 *       empty (answered, but no itinerary for these dates) and slow (an error or timeout after
 *         ≥ instantMs — Google's ~21 s error 13) = that route, today: skip it, try it once more
 *         at the end of the run;
 *       instant (an error in < instantMs) = Google refusing us: stopAfterInstant in a row stops
 *         the checks.
 *     stopAfterFailures failures of any kind in a row also stop them (Google down).
 *   - Live checks end at deadlineMin after the job started (the job runs at night, when
 *     Google answers best; GitHub Actions minutes are free for this public repo).
 */
export const VERIFY = {
  maxStops: 1, maxDurationMin: 24 * 60, topPerMonth: 25, cacheDays: 7, deadlineMin: 210,
  instantMs: 3000, stopAfterInstant: 6, stopAfterFailures: 40,
};

/** "Below other months": price ≤ ratio × median of the destination's monthly minima (≥ minMonths months). */
export const DIP = { minMonths: 3, ratio: 0.85 };

/** Hero cards: an itinerary must be ≤ 1 stop, layovers 1–6 h, no airport change, ≤ 22 h each way. */
export const QUALITY = { maxStops: 1, minLayover: 60, maxLayover: 360, maxDurationMin: 22 * 60 };
export const HERO_CANDIDATES = 4;

/** Carriers shown with the "low-cost" tag. */
export const LOW_COST = new Set(['G9', 'TR', 'FZ', 'W6', 'PC', 'VF', '6E', 'AK', 'D7', 'VJ', 'XY', 'J9', 'F3', 'JQ', 'LS', 'BY', 'TOM']);

/** Concurrent Explore calls per origin, and the pause each worker takes between calls. */
export const CONCURRENCY = 2;
export const GAP_MS = 1500;

/** Google's official names that read badly on a card; replaced by IATA. */
export const NAME_FIXES = {
  KUL: { en: 'Kuala Lumpur', ru: 'Куала-Лумпур', el: 'Κουάλα Λουμπούρ' },
  TPE: { en: 'Taipei', ru: 'Тайбэй', el: 'Ταϊπέι' },
  DPS: { en: 'Bali', ru: 'Бали', el: 'Μπαλί' },
};
