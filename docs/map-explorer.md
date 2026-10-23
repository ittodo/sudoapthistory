# Apartment map

> 문서 역할: **기능·구현 설명** · [문서 목록](README.md)
> 현재 운영·공개 자료 계약은 문서 목록의 기준 문서를 따릅니다. 날짜·건수·성능 수치는 해당 검증 조건의 기록입니다.

현재 지도는 `data/map/index.json`의 최신 가격을 먼저 표시한다. 과거 거래 카탈로그는
과거 단지 가격이나 거래 내역을 요청할 때 준비한다. 날짜 범위는 일별 인덱스에서,
시군구 선택지는 지도 인덱스에서 읽는다. 매매·전월세 전환은 같은 페이지에서 받은
지도 인덱스를 공유한다. 다운로드가 실패하면 다음 요청에서 다시 받는다.

공통 거래 판독기는 지도 요청에서 연간 상태 BIN의 초기 상태와 공통 분기 BIN의 가격 변화를 반환한다.
일반 분기 파일은 선택한 달의 변화 행만 구성하며 전체 거래 배열을 만들지 않는다.
거래 목록과 상세는 기존 전체 행 판독을 유지한다. 분할 파일은 기존 병합을 거친다.
압축 해제 버퍼가 파일 캐시에 남아 있으면 같은 버퍼의 분기·연간 판독 결과를 재사용한다.
조립한 시도·월 자료는 최대 6개 보관하며 같은 달의 날짜·필터 변경에 재사용한다.
진행 중인 같은 요청도 공유하고 실패한 요청은 다시 시도한다. 다운로드를 취소하면
해당 파일을 기다리는 미완료 판독·월 요청도 캐시에서 해제한다. 분할 파일의 하위
파일 취소에도 같은 규칙을 적용한다. 같은 날짜를 즉시 다시 조회할 수 있으며,
완료된 버퍼와 판독 결과는 유지한다. 초기 열·그룹 검사,
연간 상태 해독, 새 분기 다운로드 비용은 남는다. 화면 범위만 다운로드하는 변경은 아니다.
취소·즉시 재조회 검사는 `node --test tools/test-cloudflare-packed-cancel.mjs`로 실행한다.
분할 파일 검사는 `tools/test-housing-partition.mjs`에 포함한다.

매매 시간지도는 현재 화면에 필요한 파일과 다음 달 선읽기 파일을 구분해 보관한다.
선읽기 요청을 시작하자마자 메모리 캐시에서 취소하지 않는다. 다음 달로 이동하면
진행 중인 선읽기를 화면 요청으로 승격한다. 날짜·지역 변경으로 필요 없어진 요청은
취소한다. 분기와 연도가 바뀌어도 같은 규칙을 적용한다. 관련 검사는
`node --test tools/test-cloudflare-packed-cancel.mjs`와
`node tools/test-daily-client.cjs`로 실행한다. 저장 바이트 캐시의 비동기 저장과 상한은
[공통 읽기 계약](site-layout.md#형식과-공통-읽기-책임)을 따른다.

## 단지 선택과 지도 복귀

현재 지도와 시간지도에서 단지 가격·경계를 선택하면 통합 단지 상세를 바로 연다.
데스크톱은 공통 상세 패널을, 모바일은 상세 페이지를 사용한다. 시간지도의 중간 요약
팝업은 사용하지 않는다. 서로 다른 단지가 겹친 경우에만 단지 선택 목록을 먼저 연다.
지도에 표시한 필터에 맞는 면적과 공개 단지 ID를 전달한다. 시간지도의 정확 면적은
상세의 표시평형 규칙에 맞춰 반올림한다. 정확히 0.5인 경계는 짝수 쪽으로 묶는다.
예를 들어 104.5㎡는 104㎡ 상세로 연결한다. 원문의 정확 면적은 바꾸지 않는다. 매매 지도는 매매 상세를,
전월세 지도는 해당 유형·정확 면적·계약 연도의 상세를 연다.

시간지도는 선택할 때 재생을 멈추고 지도 위치·확대·날짜·기간·필터·재생 설정을 저장한다.
상세를 닫거나 지도에 복귀하면 이 상태를 유지한다. 모바일 상세를 열기 전에는 지도
복귀 주소를 보관한다. 상세는 최신 공개 자료의 거래 이력을 사용한다. 전월세 상세는
전달된 대표 계약 연도를 조회한다. 지도 날짜는 복귀할 지도 상태이며 과거 시점의
상세 스냅샷을 뜻하지 않는다.
시간지도에서 새로 선택한 단지는 공통 상세 URL에 기록한다. 지도 복귀 주소에
자동 재선택 값 `a`를 남기지 않는다. 기존 `#a=단지` 진입 링크는 계속 받아 상세를 연다.

관련 검증은 `node --test tools/test-cloudflare-desktop-detail.mjs`와
[전월세 지도 검증](rental-map.md#단지-경계와-선택)을 사용한다.

### 2026-10-23 공통 BIN 판독 측정

같은 공개 패키지의 78개 시군구를 새 Node 프로세스로 3회씩 조회한 중앙값이다.
기준 코드는 `40f481675e7d6d2bab01e5f471f259de575414f3`이다. 실제 client의 파일 응답,
해시 확인, 압축 해제, 상태·이벤트 계산을 포함한다. 응답은 로컬 파일로 대체했다.
초기 카탈로그 준비, 네트워크 지연, 브라우저 렌더링과 재생 대기는 제외했다.

| 순서 | 기존 | 변경 |
|---|---:|---:|
| 7월 31일 최초 가격 조회 | 1,696ms | 1,162ms |
| 8월 31일로 전환 | 1,324ms | 147ms |
| 9월 30일로 전환 | 2,822ms | 233ms |
| 9월 29일로 역이동 | 14ms | 11ms |

8·9월은 양쪽 모두 추가 다운로드와 압축 해제가 없었다. 변경본은 보유한 버퍼의
분기·상태 판독기를 재사용해 반복 해석을 없앴다. 최초 가격 조회 응답은 양쪽 모두
10,042,860바이트였다. 카탈로그 응답량은 이 수치에 포함하지 않는다.
2026년 3분기의 매매 변화 48,448행과 임대 변화 130,329행은 기존 전체 판독과
순서까지 일치했다. 네 조회의 최종 가격·이벤트·변경 목록도 일치했다.
[별도 측정 결과](../cloudflare/dist/map-reader-check-20261023/result.json)는 로컬 검사
기록이며 운영 사이트의 체감 속도나 배포 완료를 뜻하지 않는다.
읽기 전용 로컬 미리보기에서도 월별 4배 재생 완료를 확인했다. 마우스·키보드로
단지를 선택해 해당 표시평형의 실거래 탭을 열었다. 브라우저 뒤로가기는 상세를
재진입하지 않고 지도 날짜·기간·속도를 유지했다. 모바일 복귀는 자동 검사로 확인했다.

## 단지와 경계의 식별

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
현재 지도는 단지 상세 선택 뒤 거래 자료를 읽는다. 시간지도는 선택 날짜의 공통 상태와
변화를 읽는다. 필지 요청은 공유하고 캐시한다. 이전 화면의 늦은 응답은 다시 그리지 않는다.

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

지도 위치·필터는 URL hash의 `lat`, `lng`, `z`, `r`, `aL/aH`, `pL/pH`,
`uL/uH`, `bL/bH`로 유지한다. 기존 `a`(단지)와 `ar`(면적) 링크도 읽는다.
공통 상세 선택은 `detail` 쿼리와 브라우저 이력을 사용한다. 화면 이동은 현재 이력을
교체한다. 로컬 저장소에는 지도 위치와 시간지도의 마지막 보기·재생 설정을 보관한다.
첫 방문은 수도권 전체를 표시한다. 상세 표시와 복귀는 위 공통 선택 규칙을 따른다.
