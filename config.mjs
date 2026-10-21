// What we collect, and what counts as a card-worthy itinerary.

/** Origins: IATA → Freebase MID used by Explore. */
export const ORIGINS = {
  SKG: { mid: '/m/0b2mc' },
  ATH: { mid: '/m/0n2z' },
};

/** Destinations shown as cards. city/native/cc are display metadata for the site. */
export const DESTS = {
  PVG: { city: 'Shanghai', native: '上海', cc: 'cn' },
  CAN: { city: 'Guangzhou', native: '广州', cc: 'cn' },
  PEK: { city: 'Beijing', native: '北京', cc: 'cn' },
  HKG: { city: 'Hong Kong', native: '香港', cc: 'hk' },
  BKK: { city: 'Bangkok', native: 'กรุงเทพ', cc: 'th' },
  HND: { city: 'Tokyo', native: '東京', cc: 'jp' },
  ICN: { city: 'Seoul', native: '서울', cc: 'kr' },
  SIN: { city: 'Singapore', native: '新加坡', cc: 'sg' },
};

/** Trip lengths (nights) swept by the calendar. One calendar call per route × length. */
export const NIGHTS = [7, 14];

/** Calendar window: departures from today + LEAD_DAYS, WINDOW_DAYS long. */
export const LEAD_DAYS = 7;
export const WINDOW_DAYS = 180;

/** Cheapest calendar dates per route that get itinerary details, plus spares used when a date errors. */
export const CANDIDATES = 3;
export const SPARE_CANDIDATES = 2;

/** Card-worthy: ≤ 1 stop, each layover 1–6 h, no airport change, ≤ 22 h door to door (each direction). */
export const QUALITY = { maxStops: 1, minLayover: 60, maxLayover: 360, maxDurationMin: 22 * 60 };

/** A card must still be a cheap find: skip the route if the best sensible itinerary costs more than this × the calendar floor. */
export const MAX_OVER_FLOOR = 1.5;

/** Routes skipped because Google errored get one more try at the end of the run, after this pause. */
export const SECOND_PASS_PAUSE_MS = 60_000;

/** Carriers shown with the "low-cost" tag. */
export const LOW_COST = new Set(['G9', 'TR', 'FZ', 'W6', 'PC', 'VF', '6E', 'AK', 'D7', 'VJ', 'XY', 'J9']);

/** Explore (discovery list per origin): Asia region, 1-week and 2-week trips. */
export const EXPLORE = { region: ['/m/0j0k', 6], flex: { week: [0, 2], twoWeeks: [0, 3] }, keep: 12 };

/** Pause between RPC calls. */
export const GAP_MS = 1500;
