// Turn RPC payloads into plain rows.
export function calendarRows(payloads) {
  const rows = payloads.flatMap(p => (p[1] || []).map(r => ({ out: r[0], back: r[1], price: r[2]?.[0]?.[1] ?? null })));
  return rows.sort((a, b) => a.out.localeCompare(b.out));
}
export function exploreRows(payloads) {
  const meta = new Map();
  for (const p of payloads) for (const d of (p?.[3]?.[0] || [])) meta.set(d[0], { city: d[2], country: d[4], out: d[11], back: d[12] });
  const rows = [];
  for (const p of payloads) for (const f of (p?.[4]?.[0] || [])) {
    const price = f?.[1]?.[0]?.[1];
    if (!price) continue;
    const a = f[6] || [];
    const m = meta.get(f[0]) || {};
    rows.push({ city: m.city, country: m.country, out: m.out, back: m.back, price, airline: a[1], stops: a[2], durMin: a[3], iata: a[5] });
  }
  return rows.sort((x, y) => x.price - y.price);
}

const ymd = a => (Array.isArray(a) ? `${a[0]}-${String(a[1]).padStart(2, '0')}-${String(a[2]).padStart(2, '0')}` : null);
const hm = a => (Array.isArray(a) ? `${String(a[0] ?? 0).padStart(2, '0')}:${String(a[1] ?? 0).padStart(2, '0')}` : null);

/** Outbound itineraries from GetShoppingResults, each with its round-trip total price. Deduped, cheapest first. */
export function shoppingRows(payloads) {
  const seen = new Set();
  const rows = [];
  for (const p of payloads) for (const idx of [2, 3]) for (const item of (p?.[idx]?.[0] || [])) {
    const f = item?.[0];
    const price = item?.[1]?.[0]?.[1];
    if (!Array.isArray(f) || !price) continue;
    const segs = (f[2] || []).map(s => ({
      from: s[3], to: s[6], dep: hm(s[8]), arr: hm(s[10]), durationMin: s[11],
      depDate: ymd(s[20]), arrDate: ymd(s[21]),
      flight: s[22] ? `${s[22][0]}${s[22][1]}` : null, carrierCode: s[22]?.[0] ?? null, number: s[22]?.[1] ?? null,
      carrier: s[22]?.[3] ?? null, aircraft: s[17] ?? null,
    }));
    const key = segs.map(s => s.flight).join('+') + '@' + price;
    if (seen.has(key)) continue;
    seen.add(key);
    const layovers = (f[13] || []).map(l => ({ minutes: l[0], airport: l[1], changeAirport: l[1] !== l[2] }));
    rows.push({
      price, token: item?.[1]?.[1] ?? null, airlineCode: f[0], airlines: f[1] || [], stops: Math.max(0, segs.length - 1),
      depDate: ymd(f[4]), dep: hm(f[5]), arrDate: ymd(f[7]), arr: hm(f[8]), durationMin: f[9],
      plusDays: ymd(f[4]) && ymd(f[7]) ? Math.round((Date.parse(ymd(f[7])) - Date.parse(ymd(f[4]))) / 864e5) : 0,
      layovers, flights: segs.map(s => s.flight), segments: segs,
    });
  }
  return rows.sort((a, b) => a.price - b.price || a.durationMin - b.durationMin);
}
