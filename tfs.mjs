// Google Flights links. Airports: `tfs` = base64url protobuf, any number of stops.
//   Leg: field 2 date, field 13 origin {2: IATA}, field 14 destination {2: IATA}.
//   Trip: field 3 legs, field 8 trip type (1 = round trip, 2 = one-way), field 9 adults, field 19 = 1.
// Whole-city origins (London): a text query, which Google resolves to all the city's airports.
// gl/curr pin the point of sale, so the visitor lands on the prices we collected.

function encodeLeg(date, origin, dest) {
  return Buffer.from([
    0x12, 0x0a, ...Buffer.from(date),
    0x6a, 0x05, 0x12, 0x03, ...Buffer.from(origin),
    0x72, 0x05, 0x12, 0x03, ...Buffer.from(dest),
  ]);
}

export function buildTfs(legs, { adults = 1 } = {}) {
  const tripType = legs.length === 1 ? 2 : 1;
  let body = Buffer.alloc(0);
  for (const [date, o, d] of legs) {
    const leg = encodeLeg(date, o, d);
    body = Buffer.concat([body, Buffer.from([0x1a, leg.length]), leg]);
  }
  body = Buffer.concat([body, Buffer.from([0x42, 0x01, tripType, 0x48, 0x01, 0x98, 0x01, adults])]);
  return body.toString('base64url');
}

/** link = { code, cityName?, gl, curr } — the feed publishes it per origin so the site builds the same links. */
export function flightsUrl({ link, dest, out, back = null }) {
  const pos = `&curr=${link.curr}&gl=${link.gl}&hl=en`;
  if (link.cityName) {
    const q = back
      ? `Flights from ${link.cityName} to ${dest} on ${out} through ${back}`
      : `One way flights from ${link.cityName} to ${dest} on ${out}`;
    return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}${pos}`;
  }
  const tfs = buildTfs(back ? [[out, link.code, dest], [back, dest, link.code]] : [[out, link.code, dest]]);
  return `https://www.google.com/travel/flights/search?tfs=${tfs}${pos}`;
}
