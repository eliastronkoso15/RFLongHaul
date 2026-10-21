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
