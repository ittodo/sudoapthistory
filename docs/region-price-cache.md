# Regional historical prices

The map reuses its existing representative-complex selection rules. These are
as-of-date prices, not averages of contracts signed during the selected month.
Sale source identities are merged into the same public complexes as the live map;
rental same-date ordering, unavailable conversion rates and unlocated contracts
retain their existing meaning.

`data/map/price-cache/YYYY-MM-PROVINCE-TYPE.bin` is generated during asset
packaging. Each gzip JSON file contains all administrative levels in one province
for sale, jeonse or monthly rent. The opening state and absolute daily changes
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

The shared regional reader verifies SHA-256, persists up to 18 files and retains
at most nine decoded monthly files. A date change cancels obsolete pending
requests; only the latest request may render. Missing, incompatible or damaged
bundles fall back to the existing detailed calculation. Custom search, area,
price, contract and category filters also use that calculation. Province
selection and monthly conversion toggles use cached summaries.

At zoom below 16 regional prices render before optional sale transaction effects.
Those effects use the existing detailed loader in the background. Zooming in
restores ordinary apartment prices and details. Initial catalogs and map boundary
files remain shared with the existing map; this cache does not replace them.

The packaging cache is outside tracked data under
`cloudflare/dist/region-price-cache-v1`. Each entry checks input and calculation
hashes plus output integrity before reuse. CI restores this directory; changed
or corrupted entries are rebuilt. The generated manifest pins the sale, rental
and map source versions. Python and operational database writes are not involved.

Checks: `node --test tools/test-cloudflare-region-cache.mjs`, the rental-worker,
daily-client and map-model regressions, and `npm run test:site`. The region tests
cover merged complexes, representative ties, forward/reverse dates, missing
conversion rates, unmapped points, supported filters and obsolete downloads.
