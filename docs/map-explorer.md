# Apartment map

`/map/` groups the existing area rows by `aptSeq`. The bubble and initial area
selection use the latest non-cancelled trade among the areas allowed by the area
filter. A price filter tests that latest trade; it must not select an older,
cheaper area to make a complex pass. Same-day ties use area ascending and source
row order. Prices in transaction tuples are ten-thousand KRW; monthly chart
values are hundred-million KRW. Direct trades remain visible with a badge.

Administrative region bubbles show the complex count and the arithmetic mean of each member's
eligible latest-trade price, rounded to one decimal in hundred-million KRW.
Each complex contributes once; households and transaction counts do not weight
the mean. Members without a valid price remain in the count but not the mean.
Totals use every filtered member of the region, independent of viewport, selection
or detail area. Zoom 7–9 shows sido, 10–12 sigungu (including non-autonomous gu),
13–15 administrative eup/myeon/dong, and 16–19 individual apartments. No grid
aggregation remains. Dense labels are offset or hidden, but every boundary remains
clickable and exposes its own name/price on hover; zooming reveals more labels.

Thin boundaries use one pinned SGIS 2025 vintage, including parent codes/names.
The public SGIS map uses the same year. Current address text and 2025 boundaries
can differ after reorganizations (e.g. Hwaseong); the UI always states the vintage.
The raw EPSG:5179 snapshot is cached at `15_26/data/map_admin_boundaries.json.gz`.
Refresh explicitly with `python collect_map_admin.py --year YEAR` in that repo,
never on a page request or release build. Builds require shapely 2.x and pyproj 3.x.
Point-in-polygon runs on unsimplified native geometry, with invalid geometry repaired
and the repair IDs recorded. Ambiguous/missing points never infer administrative dong
from a legal-dong name. Known parents still count them; the UI reports unassigned dong.
Display-only boundaries are simplified by 4m, transformed to WGS84 and sharded by gu.
The map index embeds region metadata and per-apartment ancestor IDs; source hashes
cover every shard and the release fingerprint includes the raw snapshot.

Region boundaries and labels share a pointer guard: <=350ms, maximum movement <=8px,
one primary pointer. Long holds, fast drags, movement out/back, pinches, wheel/zoom,
pointer cancellation and duplicate clicks cannot activate a region. No pointer capture
or preventDefault interferes with Leaflet panning. Keyboard Enter remains supported.

The index includes approved/published PNU membership without a member limit.
Coordinates come from the largest cached parcel geometry or an exact full-lot-address lookup.
Legacy name-only/district coordinates are intentionally not used. Missing points
remain searchable. Lifecycle exclusions match the screener, including partial
and unknown predecessor scopes.

Build using the current release's static inputs:

```powershell
python tools/build-map-data.py --database D:/Work/15_26/snapshots/kapt_manual_review.db --coordinate-cache D:/Work/15_26/data/map_address_coordinates.json --admin-source D:/Work/15_26/data/map_admin_boundaries.json.gz
python tools/build-map-data.py --verify
node tools/test-map-model.cjs
python tools/test-map-data.py
python tools/test-map-admin.py
```

`data/map/index.json` carries SHA-256 hashes of its source files and regional
parcel shards. Detail requests verify their bytes before resolving row IDs.
A mixed release prompts refresh instead of displaying another apartment's data.
The initial page fetches the map index and visible boundary shards. Monthly, transaction and cached
parcel data load per selected district and are coalesced in memory. Missing
cached parcels fall back to the shared V-World service with bounded concurrency.
Neither building approvals nor trade databases are modified by the builder.

The production release entry point remains `D:/Work/15_26/site_release.py`.
`prepare --kind map` rebuilds map outputs against the committed site's current
index, transactions, monthly data and parcel membership. Full and parcel releases
also regenerate the map so row IDs and source hashes remain synchronized.
Review the manifest and every unpushed commit before using `publish`. Public
verification checks map data and the committed UI files after Pages and cache
invalidation complete. The publication and projection gates still apply.

URL hash fields are `lat`, `lng`, `z`, `r`, `aL/aH`, `pL/pH`, `uL/uH`,
`bL/bH`, `a` (aptSeq) and `ar` (area). Selection changes push browser history;
viewport movement replaces the current entry. Local storage retains viewport
only. First visit fits the capital region. Breakpoint is 768px; desktop panel
is 400px and mobile has collapsed, mid and full sheet positions.
