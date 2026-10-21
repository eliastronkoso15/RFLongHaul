# RFLongHaul — long-haul fare discovery probe

Experimental. This checks whether three of Google Flights' own frontend calls
answer plain HTTPS requests from a script, with no browser:

- `GetExploreDestinations` — the cheapest destinations in a region (for example
  Asia) from an origin city, with price, dates, stops and airlines.
- `GetCalendarPicker` — the round-trip price for every departure day in a date
  window, for a fixed trip length.
- `GetShoppingResults` — the itineraries for one round trip: airlines, flight
  numbers, layovers, duration and the round-trip total.

Request shapes were captured from the public web client. The probe sends no
login, solves no challenge and sends no anti-abuse token. If the service ever
requires one, the probe simply fails, and that is the intended outcome.

## Run

```bash
node probe.mjs          # Node 20+, no dependencies
```

On GitHub: **Actions → Probe long-haul RPC → Run workflow**, then pick the script. It is manual only,
uses no secrets and writes nothing external. Results appear in the job summary
and as the `probe-results` artifact.

## Files

| File | What |
|---|---|
| `rpc.mjs` | Minimal RPC client: builds the request, POSTs it, parses the streamed response |
| `parse.mjs` | Turns the parsed responses into flat rows |
| `probe.mjs` | 2 Explore calls plus 18 calendar calls, run one after another, with a summary |
| `pipeline.mjs` | Calendar → 3 cheapest dates → itineraries (`GetShoppingResults`) → quality filter. Writes `out/longhaul.json` (draft schema v0) |

## Caveats

- These are undocumented frontend endpoints. The request shapes can change with
  any frontend release.
- Prices are what Google shows at query time. They are not a booking quote.

MIT licensed.
