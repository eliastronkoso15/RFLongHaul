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
  most €500 (£425). Runaway Fly is about cheap fares (`PRICE_CAP` in
  `config.mjs`). The cap applies to Explore prices, live prices and hero cards,
  and `validate.mjs` enforces it again.

**1b. Itineraries.** Explore only gives the outbound leg. The return leg comes
from a real search (`GetShoppingResults`) in two steps, like on the site: first
the outbound options, then the returns for the chosen outbound. That is two calls
per row, and **the site shows a round trip only once both legs are known**.

What gets checked: the rows the site shows by default — the cheapest per
destination × type × month, at most 1 stop, no more than 24 h. Each checked row
gets both legs (`ob`, `ib`: flight time and layovers, airport and minutes), the
live price, and `vf: 1` (or `vc: 1` when it comes from the cache).

Order:
1. the 25 best rows of each type × month (biggest dip, then cheapest);
2. the other shown rows;
3. the other trip lengths.

Within each group the order is next month → this month → later, round trips
before one-way.

The **cache** is `cache/legs-XXX.json` in the `data` branch: per type,
destination and dates, kept for 7 days, legs only (no price).

**The search asks for at most 1 stop**, both legs — that is what the site shows.
A probe on 2026-10-22 ran 25 SKG routes that had failed, three ways:

| Search | Answered |
|---|---|
| at most 1 stop | 10 |
| any stops (as before) | 5 |
| "Best" tab | 5 |

The any-stops "Cheapest" search from Thessaloniki often runs into Google's ~21 s
error 13 (`spikes/verify-variants.mjs`).

**How failures are handled.** Each call is logged with its outcome and time.
- **empty** (answered, but no itinerary with at most 1 stop for those dates) and
  **slow** (error or timeout after ≥ 3 s — Google's ~21 s error 13 on a hard
  route): a problem with that route today. The row is skipped and the next
  night tries again. A same-day second pass got 0 of 209 at ATH.
- **instant** (error in < 3 s): Google refusing. Six in a row stop the checks for
  the day. So do 40 failures of any kind in a row.
- Live checks end 210 min into the job. The job runs at night (00:37 UTC), when
  Google's search answers best.

We never work around Google's limits.

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
1. One collect job per origin, run in parallel and independently, nightly at 00:37 UTC (up to ~4 h; GitHub Actions minutes are free for a public repo).
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
