# RFLongHaul — long-haul fare collector

This collects cheap **long-haul** trips from Thessaloniki (SKG) and Athens (ATH)
once a day and publishes them as JSON on GitHub Pages:

- **https://eliastronkoso15.github.io/RFLongHaul/v2/feed.json** — the hero cards
  per origin, and whether a list is available.
- **https://eliastronkoso15.github.io/RFLongHaul/v2/list-SKG.json** (and
  `list-ATH.json`) — every long-haul destination per month: round trips of about
  1 week and 2 weeks, and one-way.

It is a standalone, experimental system. It has no secrets and no cloud account,
and it shares no code with anything else.

## How it works (schema v2)

**1. List.** Google Flights Explore (`GetExploreDestinations`) is called for:
- 5 regions: Asia, North America, South America, Africa, Oceania;
- this month and the next 6;
- 3 kinds of trip: round trip of about a week, round trip of about two weeks, and one-way.

A row is kept only if:
- it is **long-haul**: at least 4,000 km from the origin and not in Europe;
- it has at most 2 stops;
- it takes no more than 30 h one way.

**2. Names.** City and country come in English, Russian and Greek from Google
itself (`hl=ru`, `hl=el`). They are cached in `names.json` and corrected for a
few awkward official names.

**3. Hero cards.** For each origin there are two: one round trip and one one-way,
to two different places.
- Candidates are ranked by **€ per 1,000 km**: the cheaper it is for how far it
  goes, the better.
- The top candidates are checked against real itineraries (`GetShoppingResults`,
  including the return leg).
- A **quality filter** applies: at most 1 stop, layovers of 1–6 h, no change of
  airport, and no more than 22 h each way.

**4. Norm.** `history2/YYYY-MM-DD.json` stores the cheapest price each day per
(type, month, destination). **"Below usual"** is shown once there are at least 7
days of history and today's price is at most 92 % of the 30-day median.

The `Validate` step refuses to publish a broken result: an origin needs at least
20 valid rows. When that happens, the previous files stay online.

## Run locally

```bash
node collect.mjs --out out [--data path/to/data-branch] [--origins ATH] [--months 2] [--regions asia,africa]
node validate.mjs out
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
