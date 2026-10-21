# RFLongHaul — long-haul fare collector

This collects cheap long-haul round trips from Thessaloniki (SKG) and Athens (ATH)
to Asia once a day and publishes them as one JSON file:

**https://eliastronkoso15.github.io/RFLongHaul/longhaul.json**

It is a standalone, experimental system. It has no secrets and no cloud account,
and it shares no code with anything else.

## How it works

Three of Google Flights' own frontend calls, made over plain HTTPS:

1. `GetCalendarPicker` — the round-trip price for every departure day over
   6 months, for trips of 7 and 14 nights.
2. `GetShoppingResults` — the itineraries for the cheapest dates, then the
   return leg for the chosen outbound.
3. `GetExploreDestinations` — a discovery list: the cheapest destinations in
   Asia for 1-week and 2-week trips.

A **quality filter** keeps only sensible itineraries:

- at most 1 stop;
- each layover between 1 and 6 hours, with no change of airport;
- no more than 22 hours each way.

The cheapest calendar price often fails it. For example, a 21-hour layover is
dropped and the card shows the next good option.

Request shapes were captured from the public web client. No login, no challenge
solving, no anti-abuse token. If one is ever required, collection simply stops.

## Data

| Path (Pages / `data` branch) | What |
|---|---|
| `longhaul.json` | Latest cards per origin (schema v1), the skipped routes and why, Explore lists |
| `history/YYYY-MM-DD.json` | That day's card price and calendar floor per month and trip length, per route |

**"Below usual"** is our own norm: the median card price for the route over the
last 30 days. It is shown only after at least 7 daily checks.

The `Validate` step refuses to publish a malformed or near-empty file. When that
happens the previous file stays online, and its `generatedAt` tells consumers
how old it is.

## Run locally

```bash
node collect.mjs --out out/longhaul.json [--history path/to/history] [--only SKG-PVG,ATH-BKK]
node validate.mjs out/longhaul.json
```

Node 20+, no dependencies.

| File | What |
|---|---|
| `collect.mjs` | The daily pipeline |
| `config.mjs` | Origins, destinations, trip lengths, quality rules |
| `rpc.mjs` | RPC client with retries (server error 13 = backend timeout) |
| `parse.mjs` | Response → rows |
| `norm.mjs` | Our own "usual price" from history |
| `validate.mjs` | Publish gate |
| `tfs.mjs` | Google Flights search link |
| `spikes/` | The original probes |

## Caveats

- These are undocumented frontend endpoints. The request shapes can change with
  any frontend release.
- Prices are what Google showed at collection time. They are not a booking quote.

MIT licensed.
