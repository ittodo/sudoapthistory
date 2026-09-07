# Apartment map

`/map/` groups the existing area rows by `aptSeq`. The bubble and initial area
selection use the latest non-cancelled trade among the areas allowed by the area
filter. A price filter tests that latest trade; it must not select an older,
cheaper area to make a complex pass. Same-day ties use area ascending and source
row order. Prices in transaction tuples are ten-thousand KRW; monthly chart
values are hundred-million KRW. Direct trades remain visible with a badge.

The index includes approved/published PNU membership without a member limit.
Coordinates come from the largest cached parcel geometry or an exact full-lot-address lookup.
Legacy name-only/district coordinates are intentionally not used. Missing points
remain searchable. Lifecycle exclusions match the screener, including partial
and unknown predecessor scopes.

Build using the current release's static inputs:

```powershell
python tools/build-map-data.py --database D:/Work/15_26/snapshots/kapt_manual_review.db --coordinate-cache D:/Work/15_26/data/map_address_coordinates.json
python tools/build-map-data.py --verify
node tools/test-map-model.cjs
python tools/test-map-data.py
```

`data/map/index.json` carries SHA-256 hashes of its source files and regional
parcel shards. Detail requests verify their bytes before resolving row IDs.
A mixed release prompts refresh instead of displaying another apartment's data.
The initial page fetches only the map index. Monthly, transaction and cached
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
