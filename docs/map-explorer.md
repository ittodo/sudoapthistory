# Apartment map

`/map/` first groups the existing area rows by `aptSeq`. Approved K-APT publications
in `data/housing-v3/index.json` can then combine multiple active transaction sources
into one map complex. Only apartment/trade publications with K-APT codes qualify;
shared names, addresses or PNUs alone never combine identities. The publication
snapshot is hashed with the map inputs and supplied to map/parcel release builds.
Ambiguous overlapping publications or cross-district groups fail the build.

A presentation group uses the smallest existing aptSeq as its canonical ID and
keeps every old aptSeq as an alias via `memberSources`. It shows the approved name,
whole-complex units (never the sum of duplicated source counts), and the union of
published parcel membership. Missing group units remain unknown. Construction
years are shown as a range if needed; the oldest known year is used by the year
filter. Administrative membership follows the verified representative parcel.

Same-size existing map areas are combined into one area choice. `rows` retains
all original row IDs, source aptSeq, district and name; the original index is
untouched. `sourceId/sourceName` identifies the chosen latest trade for detail
links. Latest ties use date then original row ID, with same-date counts summed.
Group details load the referenced district transaction data once. Monthly values
are recalculated from all non-cancelled trades (transaction-count weighted), not
averaged from source monthly averages. Original source names appear on trades;
identical-looking transactions in different sources are preserved without an
unverified deduplication rule. Counts and regional price means count each approved
group once. Original source-name searches and aptSeq/area links open that group.
 The bubble and initial area
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
clickable below zoom 17 and exposes its own name/price on hover; zooming reveals more labels.
At zoom 17–19, regional paths are non-interactive and activation is also guarded,
including keyboard input. Zooming back below 17 restores regional interaction.
Region activation fits the complete official bounds, with 24px padding plus the
visible detail panel. The full mobile sheet collapses before fitting. There is no
next-level minimum: a large region can remain at the same level or zoom out. A
300ms flight saves one history entry after completion; back restores the prior view.

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
or preventDefault interferes with Leaflet panning. A single pointer guard is shared
by region paths, apartment paths and price markers. Keyboard Enter/Space on price
and region markers remain supported where enabled.

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
python tools/test-map-groups.py
python tools/test-map-data.py
python tools/test-map-admin.py
```

`data/map/index.json` carries SHA-256 hashes of its source files and regional
parcel shards. Detail requests verify their bytes before resolving row IDs.
A mixed release prompts refresh instead of displaying another apartment's data.
The initial page fetches the map index and visible administrative boundary shards.
From zoom 13, it also fetches cached parcel shards only for filtered complexes
whose `parcelBounds` intersects the viewport. Bounds include all cached PNU geometry,
not just the representative coordinate, and are checked by the builder verifier.
Monthly and transaction data still load only upon selection. Parcel requests are
coalesced and cached; stale render completions cannot redraw an old viewport.

`js/map-parcels.js` keeps one visible layer per PNU. Unselected parcels have a 1px
teal stroke and transparent fill; selected parcels use the existing 3px highlight.
Both the stroke and interior select an apartment without panning or zooming. Shared
PNU owners and overlapping polygons open a choice list without merging aptSeq IDs;
polygon holes are excluded. Closing detail restores thin outlines. Below zoom 13,
only the selected complex remains eligible for boundary rendering. Unselected
complexes use static cache only; selected missing parcels retain the existing
V-World fallback. All published parcel members and representative scope survive.
Parcel and price selection take precedence over regional interaction. Missing
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
