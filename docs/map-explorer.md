# Apartment map

> 문서 역할: **기능·구현 설명** · [문서 목록](README.md)
> 현재 운영·공개 자료 계약은 문서 목록의 기준 문서를 따릅니다. 날짜·건수·성능 수치는 해당 검증 조건의 기록입니다.

현재 지도는 `data/map/index.json`의 최신 가격을 먼저 표시한다. 과거 거래 카탈로그는
과거 단지 가격이나 거래 내역을 요청할 때 준비한다. 날짜 범위는 일별 인덱스에서,
시군구 선택지는 지도 인덱스에서 읽는다. 매매·전월세 전환은 같은 페이지에서 받은
지도 인덱스를 공유한다. 다운로드가 실패하면 다음 요청에서 다시 받는다.

공통 거래 판독기는 조립한 시도·월 자료를 최대 6개 보관한다. 같은 달의 날짜·필터
변경은 이 자료를 재사용한다. 시군구 파일 캐시에서 이전 자료가 밀려나도 전체 시도의
다운로드·압축 해제를 반복하지 않는다. 진행 중인 같은 요청도 공유하며 실패한 요청은
다시 시도할 수 있다. 새 달을 처음 조회하는 다운로드 비용은 남는다.

In the legacy publication mode, `/map/` first groups the existing area rows by `aptSeq`. Approved K-APT publications
in `data/housing-v3/index.json` can then combine multiple active transaction sources
into one map complex. Only apartment/trade publications with K-APT codes qualify;
shared names, addresses or PNUs alone never combine identities. The publication
snapshot is hashed with the map inputs and supplied to map/parcel release builds.
Ambiguous overlapping publications or cross-district groups fail the build.

현재 리뷰 공개 모드는 기존 공개 단지 ID를 유지한다. 원천별 필지 목록이 달라도
같은 공개 단지를 자동 분리하지 않는다. 각 원천의 수정된 필지는 `memberSources`에
보존한다. 서로 다른 공개 단지는 이름이나 필지가 같다는 이유로 합치지 않는다.

현재 리뷰의 지도 외곽선은 생성 단계에서 단지별로 합친다. 맞닿은 필지의 내부 선을
없앤다. 떨어진 구역과 내부 구멍은 보존한다. 하나의 단지로 선택되며 빈 땅을 채우지
않는다. 검토 보정 경계가 포함되면 점선으로 표시한다. 원래 PNU와 보정 도형은 별도로
보존한다. 이 외곽선은 지적 필지 한 개를 뜻하지 않는다.

합친 도형은 `data/map/boundaries/{g}.json`에 저장한다. 지도 행의 `boundaryKey`와
상세 DTO의 `map.boundary`가 같은 도형을 가리킨다. 지도는 현재 화면의 지역 파일만
불러와 재사용한다. 브라우저에서 경계를 합치거나 현재 단지의 PNU를 하나씩 재조회하지
않는다. 경계 파일의 해시는 지도와 상세 목록에 연결한다. 새 필드가 없는 기존 공개
자료는 필지별 표시를 유지한다.

2026-10-19 격리 미리보기에서 20,542개 단지의 외곽선을 생성했다. 돈의문센트레빌의
3개 필지는 한 외곽선으로 표시됐다. 정든마을 동아 2단지와 우성 6단지는 다른 경계로
유지됐다. 매매 상세 위치와 전세 경계 클릭을 브라우저에서 확인했다.
정식 계약으로 생성한 자료는 Windows 검증 명령의 경로 처리를 고친 뒤 별도 전체
검증을 통과했다. 기존 공개 ID와 댓글 행 연결도 보존됐다. 원래 생성 실행의 실패
기록과 별도 검증 결과는 구분해 보존했다.
[검산 기록](../../15_26/_ops/current-review-migration/boundary-display-verification-20261019.json)은
격리 생성과 미리보기 결과이며 라이브 배포 완료를 뜻하지 않는다.

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
Refresh the source with the Rust `collect-map-admin` collector in `15_26/rust-kapt`.
Do not collect it on a page request or release build. The native build uses the pinned GEOS/PROJ runtime.
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

Map generation uses the Rust release pipeline. See [the release contract](../../15_26/docs/site-release-workflow.md).
The former Python map and daily builders are retired. Their reference cases remain in Git history.

The current review adapter supports isolated previews and the current publication contract.
It preserves map IDs, transaction row IDs and aliases. It keeps manual source
outlines in `corrections`. The display boundary includes these outlines in the
complex union described above. A union with a correction uses a dashed outline.
A point without a parcel remains selectable and states that its boundary is missing.
Only visible geometry is drawn. A correction without a PNU does not trigger a parcel request.

Use `node tools/test-map-model.cjs` and `node tools/test-map-parcels.cjs` for these display rules.


`data/map/index.json` carries SHA-256 hashes of its source files and regional
parcel shards. Detail requests verify their bytes before resolving row IDs.
A mixed release prompts refresh instead of displaying another apartment's data.
The initial page fetches the map index and visible administrative boundary shards.
From zoom 13, it also fetches boundary shards for current complexes and parcel shards
for legacy complexes. It fetches only regions of filtered complexes whose
`displayBounds` or `parcelBounds` intersects the viewport. Bounds include all cached geometry,
not just the representative coordinate, and are checked by the builder verifier.
Monthly and transaction data still load only upon selection. Parcel requests are
coalesced and cached; stale render completions cannot redraw an old viewport.

`js/map-parcels.js` keeps one visible layer per current complex, or per legacy PNU. Unselected boundaries have a 1px
teal stroke and transparent fill; selected parcels use the existing 3px highlight.
Both the stroke and interior select an apartment without panning or zooming. Shared
PNU owners and overlapping polygons open a choice list without merging aptSeq IDs;
polygon holes are excluded. Closing detail restores thin outlines. Below zoom 13,
only the selected complex remains eligible for boundary rendering. Unselected
complexes use static cache only. Legacy selections retain the existing V-World
fallback. Current unions report missing parcel boundaries without separate fallback
layers. All published parcel members and representative scope survive.
Parcel and price selection take precedence over regional interaction.
Neither building approvals nor trade databases are modified by the builder.

The production entry point is `D:/Work/15_26/rust/target/release/nodostream-pipeline.exe release`.
Use `prepare --kind full`. The current Rust release supports full generation.
It updates the map with the index, transactions, and parcel membership. Follow the
[release contract](../../15_26/docs/site-release-workflow.md) for the command and input review.
Review the manifest and every unpushed commit before using `publish`. Public
verification checks map data and the committed UI files after the exact SHA
Cloudflare Production workflow succeeds; Worker, manifest and public bytes must agree. The publication and projection gates still apply.

URL hash fields are `lat`, `lng`, `z`, `r`, `aL/aH`, `pL/pH`, `uL/uH`,
`bL/bH`, `a` (aptSeq) and `ar` (area). Selection changes push browser history;
viewport movement replaces the current entry. Local storage retains viewport
only. First visit fits the capital region. Breakpoint is 768px; desktop panel
is 400px and mobile has collapsed, mid and full sheet positions.
