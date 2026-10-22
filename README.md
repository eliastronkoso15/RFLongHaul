# RFLongHaul — long-haul fare collector

This collects cheap **long-haul** trips once a day and publishes them as JSON on
GitHub Pages. The origins are Thessaloniki (SKG), Athens (ATH), Yerevan (EVN) and
London (all London airports; the site's STN page).

- **https://eliastronkoso15.github.io/RFLongHaul/v2/feed.json** — the hero cards
  per origin, and whether a list is available.
- **https://eliastronkoso15.github.io/RFLongHaul/v2/list-SKG.json** (and
  `list-ATH.json`, `list-EVN.json`, `list-STN.json`) — every long-haul destination
  per month: round trips of about 1 week and 2 weeks, and one-way.

Each origin has its own point of sale and currency: GR/EUR, AM/EUR, GB/GBP.
Prices and links use the same ones, so a visitor lands on the price shown.

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
- it takes no more than 30 h one way;
- it is **under the price cap**: a round trip at most €1000 (£850), a one-way at
  most €400 (£350). Runaway Fly is about cheap fares (`PRICE_CAP` in
  `config.mjs`). The cap applies to Explore prices, live prices and hero cards,
  and `validate.mjs` enforces it again.

**1b. Itineraries.** The rows the site shows by default get real itineraries
(`GetShoppingResults`, including the return leg). These are the cheapest per
destination × type × month, at most 1 stop and no more than 24 h. Each gets:
- both legs, each with its flight time and layovers (airport, minutes) — `ob` and
  `ib` in the list;
- the live price;
- `vf: 1` when checked in this run, `vc: 1` when the itinerary comes from the
  cache.

The cache is `cache/legs-XXX.json` in the `data` branch: per type, destination
and dates, for 7 days. It holds the legs only, not the price. Coverage therefore
builds up over a few daily runs, not thousands of calls in one. The order is:
- next month first, then this month, then later months;
- round trips before one-way;
- biggest dips first, then the cheapest.

Live checks stop at 85 min into the job, or after 8 failures in a row. When
Google is slow or throttling, the rest waits for tomorrow; failed calls are not
retried.

`dp` marks a row whose price is at least 15 % below the median of that
destination's cheapest price per month.

**2. Names.** City and country come in English, Russian and Greek from Google
itself (`hl=ru`, `hl=el`). They are cached in `names.json` and corrected for a
few awkward official names.

**3. Hero cards** (picked before the bulk itinerary checks). For each origin there are two: one round trip and one one-way,
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

**Workflow.**
1. One collect job per origin, run in parallel and independently.
2. `merge.mjs` combines them.
3. `validate.mjs` checks the result.
4. The data goes to the `data` branch and is deployed to Pages.

An origin whose job fails keeps its last published list. It goes stale by
itself, and the site hides it after 48 h, while the other origins stay fresh.
Validation refuses to publish a broken result: each origin needs at least 20
valid rows.

`smoke.yml` runs a small manual collection for one origin, without publishing
anything.

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
| `merge.mjs` | Combines the per-origin job outputs; carries over origins that failed |
| `geo.mjs` | Distances, Europe set, country codes |
| `tfs.mjs` | Google Flights search link |
| `spikes/` | The original probes |

## Caveats

- These are undocumented frontend endpoints. The request shapes can change with
  any frontend release.
- Prices are what Google showed at collection time. They are not a booking quote.

MIT licensed.
