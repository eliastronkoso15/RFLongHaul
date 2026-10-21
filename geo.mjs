// Distances and country codes for "is this long-haul?" and for flags.

/** Origin airports (lat, lng). */
export const ORIGIN_COORDS = {
  SKG: [40.5197, 22.9708],
  ATH: [37.9364, 23.9445],
  STN: [51.885, 0.235],
  EVN: [40.1473, 44.3959],
};

export function haversineKm([la1, lo1], [la2, lo2]) {
  const r = Math.PI / 180;
  const a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(a)));
}

/** Europe (incl. UK, EEA, Balkans) — never long-haul, even far-flung parts like the Canaries or Azores. */
export const EUROPE = new Set([
  'AD', 'AL', 'AT', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FO', 'FR', 'GB',
  'GI', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO',
  'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK', 'SM', 'UA', 'VA', 'XK',
]);

// Google's English country names → ISO 3166-1 alpha-2, via Intl's own names plus the spellings that differ.
const OVERRIDES = {
  'united states': 'US', 'south korea': 'KR', 'hong kong': 'HK', 'macao': 'MO', 'macau': 'MO', 'taiwan': 'TW',
  'vietnam': 'VN', 'laos': 'LA', 'russia': 'RU', 'turkey': 'TR', 'türkiye': 'TR', 'czech republic': 'CZ',
  'ivory coast': 'CI', "côte d'ivoire": 'CI', 'cape verde': 'CV', 'eswatini': 'SZ', 'bahamas': 'BS',
  'the bahamas': 'BS', 'myanmar': 'MM', 'democratic republic of the congo': 'CD', 'republic of the congo': 'CG',
  'são tomé and príncipe': 'ST', 'curaçao': 'CW', 'u.s. virgin islands': 'VI', 'palestine': 'PS',
  'brunei': 'BN', 'east timor': 'TL', 'timor-leste': 'TL', 'micronesia': 'FM', 'saint kitts and nevis': 'KN',
  'saint vincent and the grenadines': 'VC', 'saint lucia': 'LC', 'trinidad and tobago': 'TT',
};

let byName = null;
function nameIndex() {
  if (byName) return byName;
  byName = new Map(Object.entries(OVERRIDES));
  const dn = new Intl.DisplayNames(['en'], { type: 'region' });
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const a of A) for (const b of A) {
    const code = a + b;
    let name;
    try { name = dn.of(code); } catch { continue; }
    if (name && name !== code && !byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), code);
  }
  return byName;
}

export function countryCode(enName) {
  if (!enName) return null;
  const key = String(enName).toLowerCase().replace(/[’`]/g, "'").trim();
  return nameIndex().get(key) ?? null;
}
