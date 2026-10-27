# Regional historical prices

> 문서 역할: **기능·구현 설명** · [문서 목록](README.md)
> 현재 운영·공개 자료 계약은 문서 목록의 기준 문서를 따릅니다. 날짜·건수·성능 수치는 해당 검증 조건의 기록입니다.


The map reuses its existing representative-complex selection rules. These are
as-of-date prices, not averages of contracts signed during the selected month.
Sale source identities are merged into the same public complexes as the live map;
rental same-date ordering, unavailable conversion rates and unlocated contracts
retain their existing meaning.

Asset packaging generates `data/map/price-cache/YYYY-QN-PROVINCE-TYPE.bin`.
With schema-3 sale and rental sources, only these quarterly files are published.
Monthly frames remain internal calculation and packing inputs. Each quarterly
file is gzip JSON, not an indexed binary table. It contains the available monthly
frames for one province and one type: sale, jeonse or monthly rent. Each frame
contains all administrative levels in that province. The opening state and absolute daily changes
contain complex counts, priced counts and price sums. Monthly rent stores cash
rent, actual deposits, converted monthly rent and deposit equivalents. Each
contract's deposit equivalent is `deposit + rent * 1200 / annual_percent_rate`;
conversion happens before averaging. Missing/nonpositive rates are excluded
from both equivalent-price averages. The regional card defaults to showing both
equivalents; the raw toggle shows average actual deposit / average cash rent.
Explicit URL and saved conversion choices remain respected.
Parent averages use complex sums/counts rather
than averaging child averages. Administrative codes are the existing SGIS IDs;
the filename province uses the existing source province code (41/11/28).

Rental apartments without a complete administrative assignment are stored as
sparse point changes so their markers remain available at regional zoom levels.
No apartment/area/day Cartesian product is materialized. Files are generated
only for source months, and dates without changes carry the last state forward.

The shared regional reader verifies SHA-256 and persists up to 18 files.
After a foreground load, it removes completed files from memory when the cache
has more than six entries. It protects the current files and the next-quarter
prefetch files. Pending requests can temporarily exceed this count.
A date change cancels obsolete pending
requests; only the latest request may render. Missing, incompatible or damaged
bundles fall back to the existing detailed calculation. Custom search, area,
price, contract and category filters also use that calculation. Province
selection and monthly conversion toggles use cached summaries.

At zoom below 16 regional prices render before optional sale transaction effects.
Those effects use the existing detailed loader in the background. Zooming in
restores ordinary apartment prices and details. Initial catalogs and map boundary
files remain shared with the existing map; this cache does not replace them.

The private SQLite cache is outside tracked data at
`cloudflare/dist/housing-cache.sqlite`. The price scope stores calculation results.
`cloudflare/dist/region-price-cache-v2` contains output files for packaging.
Small month receipts bind input and calculation hashes to result hashes.
The builder checks the current quarter payload before reuse. It reads monthly
payloads only when a quarter needs packing. Schema-3 monthly files stay in the
private database. Required missing or damaged entries are rebuilt.
See the [cache reuse and measurement rules](cloudflare-auto-deployment.md).
CI restores the private cache database. The generated manifest pins the sale, rental
and map source versions. Python and operational database writes are not involved.

Quarter packing has a separate receipt. It includes the JSON serializer code
and the SHA-256 of each monthly frame in that quarter. A matching receipt and
output hash reuse the existing gzip bytes without parsing or packing the months.
The serializer is `tools/region-price-quarter.mjs`. Changes to this serializer
refresh quarter receipts without repeating price calculations. Changes to the
unrelated packed-record codec do not invalidate JSON quarter receipts.

Price selection and aggregation use `js/map-pricing.js`. Map display and pointer
rules use `js/map-model.js`. Both the map and apartment detail pages load pricing
before the display model.
The regional calculation hash includes the pricing module and the shared
`js/housing-map-quarter.mjs` reader. It excludes the display module.
A display-only change reuses valid price frames. A change to pricing, the reader,
or an input rebuilds the affected frames. The weekly calculation hash
uses the same pricing module. The first build after this split has a new hash.

Checks: `node --test tools/test-cloudflare-region-cache.mjs`, the rental-worker,
daily-client and map-model regressions, and `npm run test:site`. The region tests
cover merged complexes, representative ties, forward/reverse dates, missing
conversion rates, unmapped points, supported filters and obsolete downloads.

## Quarterly transport

The monthly frames are packaged as
`YYYY-QN-PROVINCE-TYPE.bin`, with `{schema:1, months:{"YYYY-MM":frame}}`.
Each month retains its own opening state and daily replacements; no new price
calculation or averaging is introduced. Partial quarters contain only available
months. Packing holds one quarter in memory at a time.

For schema-3 sale and rental sources, the price-cache index uses schema 2.
Its `sources` object is empty. `quarterSources` supplies independent SHA-256
digests. Its `format` is `gzip-json`. The quarterly payload still uses schema 1; this is a separate version
from the index. For older source combinations, the builder retains a schema-1
index with monthly `sources` and `quarterSources`. Clients prefer quarters,
reuse them for forward/reverse month changes, and warm the next available
quarter after the visible frame completes. Pending warm downloads are shared
with foreground requests; obsolete work is cancelled on context changes.
Prefetch failures do not delay the visible frame. Old manifests remain supported.
All generated assets remain covered by the deployment manifest and CI checks.
The client can also read experimental `packed-records-v1` quarters. The current
producer does not emit that format. JSON quarters are decompressed and parsed
once per retained file; later month changes reuse those objects.

At apartment zoom levels, rental prices use the shared quarterly facts and
annual opening states. The reader assembles the selected month. This path does
not use the regional summary files. See the [map reader contract](map-explorer.md).

The 2026-09-22 transport check measured April-June 2026 monthly-rent data across all three
provinces: 977,745 bytes per quarter versus 1,003,036 bytes in three monthly
sets. Once loaded, April/May/June changes require no further regional downloads
(3 requests per quarter instead of 9). April alone was 335,678 bytes: first-load
transfer is larger, while subsequent month transitions avoid network waits.
These are transport measurements, not a claim about phone rendering latency.

## Binary comparison on 2026-10-23

Two existing local quarter files were compared with generic packed records and
a separate typed-region prototype. All outputs used gzip level 6. The check
used Node 22.18.0, two warm-up runs and 20 measured runs. Times below are medians
for decompression and the first selected-month read. They exclude downloads,
browser workers, rendering and timeline scheduling.

| File | Existing JSON bytes | Generic BIN bytes | Typed BIN bytes | JSON read | Typed BIN read |
|---|---:|---:|---:|---:|---:|
| `2026-Q3-11-sale.bin` | 62,839 | 98,544 | 85,945 | 3.26 ms | 5.80 ms |
| `2023-Q1-41-monthly.bin` | 632,522 | 677,761 | 534,949 | 20.42 ms | 29.45 ms |

The typed format reduced the monthly-rent file size but increased both read
times. The sale file also became larger. The producer therefore retains gzip
JSON and the separate quarter cache. The typed prototype was removed from the
site schema and runtime. It remains only in the local measurement report.
Jeonse was not timed; its five-value region tuples were outside this prototype.

The [measurement report](D:/Work/_ops/reports/packed-transport-20261023/region-measurement.json)
records exact source hashes, the local snapshot commit, code hashes and samples.
The adjacent `region-measurement.mjs` and codec snapshots reproduce the check.
This local comparison does not establish deployment or browser performance.
