// Google Flights search link (`tfs` = base64url protobuf), any number of stops.
// Leg: field 2 date, field 13 origin {2: IATA}, field 14 destination {2: IATA}.
// Trip: field 3 legs, field 8 trip type (1 = round trip), field 9 adults, field 19 = 1.

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

export function flightsUrl({ origin, dest, out, back = null }) {
  const tfs = buildTfs(back ? [[out, origin, dest], [back, dest, origin]] : [[out, origin, dest]]);
  return `https://www.google.com/travel/flights/search?tfs=${tfs}&hl=en&curr=EUR`;
}
