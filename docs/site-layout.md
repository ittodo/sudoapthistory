# Site layout and producer contract

> 문서 역할: **현재 지침** · [문서 목록](README.md)
> 지침을 먼저 읽고 구현·측정 근거는 뒤에서 확인합니다.


Company data is owned by `companysearch`; apartment data is owned by `15_26`.
This repository contains public artifacts and their consumers, not a second company generator.

Run `node tools/verify-site-layout.mjs` before deployment. It checks the working tree,
including ignored retired company folders. `--staged` checks the Git index;
`--ref HEAD` checks a committed tree; `--source DIRECTORY` checks a prepared output
directory without requiring Git. `--root DIRECTORY` selects a different repository.
`--json` reports each path, byte size and content hash, plus a reproducible manifest hash.
Git snapshots use Git blob hashes; disk artifacts use SHA-256.

The CLI also supports Windows extended paths (`\\?\D:\...`). This includes a
relative script path from an extended working directory, as used by the Rust
publisher. These calls run the same checks and return the same report and exit
status. A module import does not run the CLI. Run `node tools/test-site-layout.mjs`
to check these entry points with valid and forbidden output files.

`--allow-existing-legacy` is audit-only and must never appear in a publish command.
Retired `data/div/` and `div/data/`, nested earnings directories and data backup/temp
files are forbidden. A duplicate-content count is informational, not authorization
to delete. Normal per-ticker `data/earnings/` files remain separate.

Both publishers acquire the first-byte OS lock in the Git common directory's
`nodostream-publish.lock`. The lock file is persistent and must not be removed;
its existence does not mean the lock is held. Apartment maintenance gates and its
existing release lock remain mandatory. Never stage another producer's changes.

The GitHub layout workflow is an additional check; local publication must validate
before push. The current provider is Cloudflare. The final exact SHA must pass
Cloudflare Production push/main, Worker/manifest and normal public-byte checks.
Pages/Purge are not current completion gates. See [deployment contract](cloudflare-auto-deployment.md).
No DB backup is created by this workflow; committed static files are recoverable
with a reviewed revert commit. Uncommitted user changes must be preserved.

Apartment detail pages read the shared quarterly facts. The files in
`data/sale-details/` hold sale references and cancellation text, not another full
transaction history. Rental archive files under `data/contracts/apartment-rent/`
hold only contract fields that the shared facts do not contain.
The 64 `data/apartments/entry/` files route detail reads to the actual source region.
The unpublished dong history copies and their producer and reader were removed.
See the [current detail contract](apartment-and-board.md#공통-거래를-사용하는-단지-상세).

## 페이지 기능별 데이터 사용 계약

이 절은 화면 기능과 공개 자료를 연결하는 기준이다. 같은 URL도 거래 유형, 탭,
지도 모드에 따라 필요한 자료가 다르다. 물리 파일 이름만으로 소비자를 분류하지 않는다.
아래의 현행은 현재 소비자 코드 기준이다. 운영 공개 여부와 파일 수는 해당 배포의
manifest로 확인한다. 빌드 때 생성하는 캐시는 작업 폴더에 없을 수 있다.

생성 측 논리 테이블 10개와 형식은 [주택 저장 계약](../../15_26/docs/housing-packed-storage.md#논리-테이블)이 기준이다.
단지·면적 식별자, 표시 메타데이터, 승인 연결, 매매·임대 사실, 계약 추가 정보,
환산율, 비교·상태·요약, manifest·수집 상태의 역할을 유지한다.
아래 11개는 화면 기능 분류이며 새 원천 테이블이나 별도 거래 복제본을 뜻하지 않는다.
공통 거래 원문은 한 번 저장한다. 화면별 파일에는 필요한 색인·집계·상태만 둔다.
기존 월별 목록과 다른 주택 유형 자료는 전환 계획 없이 삭제하지 않는다.

### 현행 소비 경로

표의 정적 자료 경로는 `data/` 아래를 기준으로 쓴다. API 경로는 `/api/`로 구분한다.

| 기능 | URL·탭·모드 범위 | 현재 읽는 자료와 시점 |
|---|---|---|
| 1. 단지 검색 목록 | `/`의 `tenure=sale/jeonse/monthly`, 지역·검색·가격·면적·정렬. 공통 자동완성의 `searchApt` | 홈은 `search/latest-index.json`, `search/latest/`의 ID 해시별 gzip JSON과 `index.json`을 결합한다. 건축물 상태·재건축 관계도 읽는다. 자동완성은 첫 사용 또는 URL 선택 복원 때 `search/apartments.json` manifest와 `search/catalog/` gzip JSON을 읽는다. 두 자료는 각각 32개 `.bin`이며 `format: gzip-json-records-v1`로 구분한다. 홈의 기간 수익률에는 `prices.json`이 필요하다. |
| 2. 현재 지도 | `/map/`의 현재 모드, 매매·전세·월세, 지역·면적·가격 조건, 확대 수준 | 매매는 `map/index.json`의 현재 단지·평형 요약과 지도 지리 자료를 사용한다. 임대는 rental manifest·카탈로그·환산율과 지도 상태 경로를 사용한다. 확대 수준과 필터에 따라 지역 요약 또는 단지 상태를 읽는다. 경계·필지는 필요한 지역을 읽는다. |
| 3. 시간별 가격 지도 | `/map/#mode=price`의 `date/start/end/step/speed/fx`, 매매·전세·월세. 호환 `mode=day`는 당일 거래 | 넓은 지도에서 지원 조건이면 `map/price-cache` 지역 요약을 사용한다. 확대 지도·세부 조건·거래 효과에는 공통 분기 거래의 변화와 연간 초기 상태를 사용한다. 연간 `PGSTBND1`의 거래 종류 구간은 HTTP Range로 읽는다. |
| 4. 기간별 거래 조회 | `/trades/`, `/trades/daily/`의 매매·전세·월세, 일/주/월·날짜·분류·정렬·검색 | 매매 `/trades/`는 `market/<월>/<페이지>.json`을 읽고 선택 시 월별 통계 등을 읽는다. 매매 기간별 조회는 daily manifest와 공통 분기 거래를 사용한다. 임대는 rental manifest·카탈로그·환산율과 선택 기간 공통 거래를 사용한다. 임대 초기화에는 최신 거래일 계산을 위한 최신월 읽기도 있다. |
| 5. 계약 상세 조회 | `/trades/contracts.html?property=apartment/rowhouse/officetel&category=jeonse/monthly/all-rent/sale` 및 `lawd/entity`, 화면의 기간·면적·검색. 매매는 오피스텔만 지원 | `contracts/index.json`의 선택 지역·월 partition을 읽는다. schema 2의 아파트 `regional-reference`는 공통 원문과 계약 추가 정보·표시 사전을 결합한다. 연립·오피스텔은 기존 계약 JSON을 유지한다. 단지 상세 연결 확인에는 `apartments/index.json`도 읽는다. |
| 6. 단지 상세 | `/apartment/?id=…&area=…&tab=overview/trades/rent/investment/facts/location/comments`, 임대 `rentType/rentPeriod/rentArea`, 이전 `row` 링크 | entry manifest와 선택 색인으로 DTO와 실제 원천 지역을 찾는다. DTO는 `apartments/<묶음>.bin`이며 선택 ID만 복원한다. 개요·실거래는 공통 매매 원문과 `sale-details` 참조를 사용한다. 전월세 탭은 공통 임대 원문과 계약 추가 정보를 읽는다. 위치는 경계·지도, 의견은 API를 탭 진입 때 읽는다. |
| 7. 비교·시장 추이 | `/compare/`의 단지/시구/동, 연/월, 가격/투자 시뮬; `/market/`의 거래 유형·기간·지역·가격구간·기준월 | 매매 비교는 공통 목록 색인과 `prices.json` 등 집계 자료를 사용한다. 매매 시장은 `market.json` 요약과 별도 월별 거래 목록을 읽는다. 임대 시장은 `rental/market-cache/<연도>-summary.bin`을 우선 사용한다. 다중 시군구·단지·금액/면적 범위 또는 계약 목록 요청은 공통 원문 경로로 전환한다. 가격 차트 금리는 `market-rates/mortgage.json`이다. |
| 8. 주택 가격대 통계 | `/stats/` 매매의 지역·동·가격구간·면적·세대수/시가총액·연도·세금 비교 | `price_bands.json`, `index.json`, `tax_revenue_actuals.json`을 함께 읽는다. 최신 주택 재고와 과거 시점 집계를 표시한다. 단지 목록은 전체 목록에서 조건을 적용하고 최대 300개를 표시한다. |
| 9. 기간 계약 분포·순위 | `/stats/`, `/ranking/`, `/compare/`의 전세·월세, 날짜·일/주/월·환산·계약 구분·검색·범위 | 공통 rental 앱은 페이지별로 히스토그램·순위·지역 비교·추이 패널을 켠다. 선택 기간 계약을 공통 원문에서 읽고 필터·집계한다. 비교의 추이 패널은 `rental/summary.json`도 읽는다. `/stats/` 임대는 매매 `price_bands.json`이나 시장 요약 캐시를 사용하지 않는다. 표시 목록 50개 제한은 원문 읽기 범위를 줄이지 않는다. |
| 10. 관심·보관함 | `/library/`의 관심 아파트/저장한 계산, 매매 기본 `/ranking/`의 하트 순위 | 관심 목록은 `/api/me/favorites`, 하트 API, 선택 entry와 `apartments/summary/<묶음>.bin`을 사용한다. Worker의 단지·면적 확인도 같은 요약 reader를 사용한다. 저장 계산은 개인 API의 입력·결과 스냅샷만 읽는다. 로그인하지 않은 보관함은 주택 자료를 읽지 않는다. |
| 11. 공동주택 정보 | `/kapt-v2.html`의 지역·유형·검색·이전 `#k` 선택 | `housing-v3/index.json`의 공개 항목·연결·단지 메타데이터를 읽는다. 통합 상세로 이어지는 식별자를 사용한다. 공개 목록 수, 검토 승인 수, 건축물 상태를 서로 다른 의미로 유지한다. |

현재 경로의 근거는 [홈 자료 결합](../js/home-search-view.js), [공통 검색](apartment-search.md),
[지도](map-explorer.md), [기간 거래](daily-trades.md), [계약 목록](../js/contracts.js),
[단지 상세](apartment-and-board.md), [임대 시장](rental-market.md),
[가격대 통계](price-band-statistics.md), [보관함](member-library.md)에 있다.
지도 UI와 복귀 동작의 세부 기준은 지도 문서에서 유지한다.

### 목표 읽기 계약과 최소 데이터

이 표는 소비자와 생성기를 바꿀 때 지킬 목표다. 모든 행이 이미 구현됐다는 뜻은 아니다.
파일명·파일 개수는 여기서 새로 고정하지 않는다. 자료 규모와 조회 범위를 확인한 뒤 정한다.

| 기능 | 최소 필드와 자료 역할 | 첫 화면·지연 읽기 | 필요한 색인·캐시 |
|---|---|---|---|
| 단지 검색 목록 | 공개 ID, 원천 연결, 이름·지역·검색어, 정확 면적, 최신 가격·일자, 표시/정렬 지표. **식별·메타데이터·최신 요약** | 목록 요약을 먼저 표시한다. 거래 원문·전체 상세·지도 지리는 목록 진입만으로 읽지 않는다. 추가 지표는 해당 기능 사용 시 읽는다. | 단지/평형 ID와 지역 색인. 검색 목록·최신 요약·요청 중 Promise 재사용. |
| 현재 지도 | 단지/평형 ID, 좌표·경계 참조, 최신 유효 가격·일자, 대표면적·표시 조건. **최신 요약·상태** | 지역 요약을 먼저 표시한다. 확대 시 필요한 단지 상태와 지리를 읽는다. 클릭 뒤 상세 자료를 읽는다. | 지역·단지·면적 조회와 지리 캐시. 최신 요약과 상세의 원문 캐시를 구분한다. |
| 시간별 가격 지도 | 초기 상태, 날짜별 변경 위치, 거래 종류·단지·평형 ID, 가격·비교 상태. **상태·변화 색인** | 해당 시점 복원에 필요한 상태와 변화만 해석한다. 재생의 다음 구간 준비는 취소·재사용 가능해야 한다. | 월·날짜·평형별 위치 색인, 압축 해제 버퍼에 결합한 해독 캐시, 제한된 프레임 캐시. 분기 전체 거래 객체 생성과 분리한다. |
| 기간별 거래 조회 | 계약일·정확 면적·층·금액·상태·비교 근거·단지 참조. **공통 원문·조회 색인** | 선택 기간/지역을 읽는다. 표의 추가 표시와 다른 달 다운로드를 구분한다. | 기간·지역·평형·종류별 묶음 위치, 정렬/페이지 참조. 페이지 전용 전체 거래 복제본을 새로 만들지 않는다. |
| 계약 상세 조회 | 공통 거래 참조, 계약 기간·구분·종전 금액·갱신권·해제일, 이름/주소 참조. **원문·추가 항목** | 선택 유형·지역·기간만 읽는다. 다른 유형 자료를 아파트 연결 확인 때문에 선행 로딩하지 않는다. | 거래 식별자와 추가 항목의 결합 색인, 지역 표시 사전 캐시. 기존 다른 주택 유형 계약은 별도 보존한다. |
| 단지 상세 | 단지/면적 ID·기본 정보·출처, 최신/최근 요약, 선택 탭에 필요한 거래와 추가 항목. **메타데이터·요약·공통 원문** | entry와 선택 단지 요약을 먼저 읽는다. 매매·임대·위치·의견은 활성 탭의 범위만 읽는다. | entry → 실제 원천 지역 → 단지/평형 위치. 선택 단지와 공통 원문 버퍼를 재사용한다. |
| 비교·시장 추이 | 월·지역·단지별 건수·합계·평균·중위값·가격구간, 금리/환산율. **집계·기준표** | 차트 요약을 먼저 표시한다. 임의 상세 필터·계약 목록 요청만 원문으로 전환한다. | 월/지역 집계 색인, 선택 대상 시계열 캐시. 여러 지역의 중위값을 평균하여 전체 중위값으로 만들지 않는다. |
| 주택 가격대 통계 | 시점별 세대수·최신가격·가격구간·시가총액, 회전율 분모, 세금 실적. **재고 상태·집계** | 가격대 요약부터 표시한다. 단지 목록과 세금 패널은 사용 시 필요한 열을 읽는다. | 지역/시점/가격구간 집계와 목록용 열 색인. 기간 계약 건수와 주택 재고 분모를 혼합하지 않는다. |
| 기간 계약 분포·순위 | 선택 기간의 계약 금액·면적·계약 구분·환산 기준·비교값. **원문에서 파생한 집계** | 일반 조건은 검증된 집계로 처리할 수 있다. 임의 조건은 공통 원문에서 계산한다. 순위 상위 표시 수가 집계 모집단을 줄이지 않는다. | 기간/지역/종류 색인과 필터 결과 캐시. 최신일은 가능하면 manifest의 근거 있는 값으로 찾는다. |
| 관심·보관함 | 관심 ID·선택 면적, 최신 거래·최근 평균/5건, 개인 계산 스냅샷. **공개 요약·개인 API** | 관심 ID를 받은 뒤 해당 요약만 읽는다. 저장 계산 탭은 주택 카탈로그 없이 표시한다. | ID 라우팅·선택 요약 캐시. 비공개 API 캐시를 공개 파일 캐시와 섞지 않는다. |
| 공동주택 정보 | 공개 ID·이름·주소·용도·세대수·연결·상태·근거. **메타데이터·승인 연결** | 목록 필드 먼저, 선택 항목 세부 정보는 지연한다. 거래 원문은 단지 상세 기능에 진입한 뒤 읽는다. | 공개 ID·이전 별칭·지역·연결 색인. 미확인 상태를 0·현행·철거로 임의 변환하지 않는다. |

### 형식과 공통 읽기 책임

확장자가 `.bin`인 것과 숫자 열을 위치로 읽는 packed 형식은 다르다.
gzip JSON은 압축을 푼 뒤 문자열 해석과 객체 생성이 필요하다.
packed 형식도 전체 행을 객체로 펼치면 색인의 이점을 충분히 쓰지 못한다.
같은 파일을 HTTP로 일부 받는 것과 받은 버퍼에서 일부 행만 해석하는 것도 구분한다.

| 자료 | 현재 형식·역할 | 전환 판단 |
|---|---|---|
| 공통 분기 거래·연간 초기 상태 | `PGHOUSE1`, `PGSTBND1` 안의 `PGSTATE1`, 숫자 열 `PGCOL001` | 이미 실제 packed다. 우선 과제는 기존 위치표와 버퍼를 소비자가 재사용하는 것이다. 새 거래 원문 파일을 만들 이유가 아니다. |
| 단지 DTO·관심 요약·임대 시장 요약 | gzip 안의 `PGRCD001`, `PGCOL001` 숫자 열·문자열 사전·레코드 색인 | JSON 문자열 본문을 저장하지 않는다. 단지 또는 월 키를 이진 탐색한 뒤 해당 레코드만 복원한다. 기존 공개 JSON/gzip JSON도 읽을 수 있다. |
| 검색 목록·검색 최신 요약 | 각각 32개 고정 ID 해시 버킷의 gzip JSON `.bin`, `format: gzip-json-records-v1` | 전체 목록을 만드는 현행 경로에서는 generic BIN보다 작고 최초 전체 읽기도 빨랐다. 파싱한 객체를 캐시하고 ID 키로 접근한다. [검색 형식과 측정](apartment-search.md#전송-형식-선택-근거-2026-10-23)이 기준이다. |
| 지도 가격 캐시 | 기존 gzip JSON 분기 `.bin` | 실자료 표본의 BIN 크기·초기 조회가 불리해 기존 형식을 유지한다. 계산 결과와 분기 압축 결과를 재사용한다. [지역 가격](region-price-cache.md)이 기준이다. |
| 지역 번호표·메타데이터 | 78개 지역별 JSON | 영구 번호와 Rust 이전 자료 판독 계약을 유지한다. 이 변경에서 형식을 바꾸지 않는다. |
| 지도 목록·대규모 목록 색인 | JSON과 기존 `index.packed.bin` 읽기 경로가 공존 | 기존 packed 열을 재사용할 수 있는 소비자부터 검토한다. 홈의 최신 임대 요약 결합 등 추가 필드도 함께 보존해야 한다. |
| 경계·필지 등 지리 자료 | 지역별 JSON | 지역 지연 읽기와 캐시부터 확인한다. 좌표 형식 전환은 후순위 후보이며 정밀도·도형 의미를 보존한다. |
| 작은 entry·manifest·금리·환산율·API 응답 | 라우팅/기준표/동적 JSON | 일괄 BIN 전환 대상이 아니다. 해시·범위·버전·출처를 명확히 유지한다. |

현재 공통 책임은 여러 모듈로 나뉜다. `verified-data-cache.js`는 파일 다운로드·무결성과
바이트 캐시를 맡는다. `regional-data.js`와 `housing-regional.mjs`는 공개 manifest·지역
번호표·공통 거래를 연결한다. 매매·계약 상세 reader는 공통 사실과 추가 항목을 결합한다.
`housing-map-quarter.mjs`는 브라우저와 Node에서 지도용 분기 변화 색인을 읽는다.
`packed-records.mjs`는 레코드 위치와 typed 값을 읽고, `apartment-records.mjs`는
단지 기본 기준일을 복원한다. `packed-data.mjs`는 검색용 고정 묶음과 파싱 객체 캐시를
연결하며 기존 `packed-records-v1`도 읽는다. JSON 객체의 ID 조회와 BIN의 선택 객체
복원을 구분한다. 검색 캐시의 해제 바이트 예산은 실제 JS 힙 상한이 아니다.
화면 앱은 필터·표시·재생 상태를 맡는다. 단일 클래스가 모든 페이지 자료와 개인 API를
총괄하는 구조는 아니다. 공통 자료를 각 페이지에서 새로 해독·복제하지 않도록 이 경계를 유지한다.

같은 실행환경의 동일한 경로·해시·거래 종류 구간 요청은 공유한다. 매매·전월세의
공통 파일 캐시는 256개·압축 바이트 64MiB를 상한으로 한다. 창과 Worker는 완료된
Cache Storage 항목을 공유한다. 서로 다른 실행환경의 동시 최초 요청까지 합치지는 않는다.
개별 요청 취소는 다른 구독자를 중단하지 않는다. 저장 실패는 정상 조회를 막지 않는다.
저장 바이트 캐시, 압축 해제 버퍼,
해독된 열/색인, 선택 월·화면 결과의 캐시 수명은 구분한다. 화면 결과는 제한된 크기로
유지하고 자료 버전이 달라지면 혼합하지 않는다. HTTP Range는 현재 연간 상태 구간에
적용된다. 공통 분기 파일 전체를 임의 행 단위로 Range 다운로드할 수 있다는 뜻은 아니다.

### 이번 변경 범위와 남은 전환

아래 항목은 소비자와 전송 파일 포장 변경의 범위다. 지도 상세 연결의 구현·검증 상태는
[지도 문서](map-explorer.md)를 따른다. 앞선 2026-10-23 로컬 검증에서는 BIN 읽기와
선행 로딩 정리의 구현·선택 회귀 검사를 확인했다. 운영 반영 상태는
[공식 릴리스 기록](../../15_26/docs/site-release-workflow.md)의 run과 같은 SHA의 CI·공개 검증 근거를 따른다.

- 지도 선택을 기존 공통 상세 열기로 통일했다. 데스크톱 공통 상세 패널과 모바일 상세
  페이지를 유지한다. 시간지도 중간 팝업을 제거하고 현재 지도·임대의 기존 직접 연결과
  맞췄다. 단지·표시평형을 전달하고 복귀할 지도 상태를 보존한다. 지도 시점은 복귀
  상태이며 상세는 최신 공개 자료를 사용한다. 전월세 상세는 전달된 계약 연도를 조회한다.
- 지도 상태 요청에는 공통 BIN의 지도용 변화 색인을 읽는 경로를 연결했다. 선택 월의
  행을 필요할 때 구성하고, 같은 압축 해제 버퍼의 해독 결과를 재사용한다. 지도 반환값은
  전체 거래 `rows` 대신 초기 상태와 변화를 담는다. 거래 목록과 상세의 전체 행 API는
  유지한다. 분할 파일은 기존 전체 병합을 거친 뒤 지도 반환값에서 `rows`를 보관하지 않는다.
  분기 파일의 압축 해제 단위·초기 그룹 검사와 연간 상태 해독은 바꾸지 않았다.
  다운로드 취소 시 관련 미완료 판독 요청을 함께 해제해 즉시 재조회할 수 있게 했다.
- 홈·비교의 사용하지 않는 `volumes.json`, `details.json`, `geo.json` 선행 로딩을 제거했다.
  홈 기간 수익률과 비교 가격 추이에 사용하는 `prices.json`은 유지한다.
  회원 활동은 아파트 활동 항목이 있을 때만 단지 색인을 읽는다.
- 단지 DTO 256개와 관심 요약 256개는 기존 ID 해시 경계를 유지한 BIN으로 교체한다.
  공통 기준일은 manifest에서 복원한다. entry 64개에는 라우팅만 두고 공통 출처·기준일·
  묶음 해시는 entry-index에 한 번 저장한다. 내용만 바뀌면 라우팅 파일을 다시 쓰지 않는다.
- 검색 목록과 최신 요약은 각각 32개 고정 ID 해시 묶음의 gzip JSON을 사용한다.
  파일 이름에 내용 SHA-256을 넣는다. 새 단지가 추가돼도 다른 묶음의 경계가 이동하지 않는다.
  첫 전체 검색·필터는 전체 목록을 구성한다. 유지된 파싱 객체는 다시 파싱하지 않는다.
  이후 방문은 같은 압축 파일 바이트를 재사용한다. 형식 선택 근거는 [검색 문서](apartment-search.md)를 따른다.
- 지역 가격은 기존 gzip JSON 분기·시도·거래 유형 경계, 임대 시장은 BIN 연도 경계를 유지한다.
  계산 캐시와 포장 캐시의 지문을 나눈다. 코덱만 바뀌면 가격 계산을 재실행하지 않는다.
  최초 생성 코드 변경으로 생기는 1회 캐시 무효화와 이후 작은 변경을 구분한다.
- 실제 공개 파일 교체는 공식 생성·폐기 증명·동일 SHA 검증을 거친다. 생성용 단지 JSON을
  BIN과 함께 중복 배포하지 않는다. 상세 원문 거래나 기존 비아파트 자료는 삭제하지 않는다.

전체 지역 metadata의 선택 로딩, 분할 파일의 직접 부분 해독, 지도 화면 범위에 따른
다운로드 축소, 지도 해독의 Worker 이전, 시장 거래 목록의 공통 원문 참조 전환은
이 변경에 포함하지 않는다. `map/index.json`, `index.json`, `prices.json`, `price_bands.json`,
지역 번호표·metadata의 생산 계약도 유지한다. 이들은 다음 전환 후보이며 BIN 전환 완료로
표시하지 않는다. 작은 manifest·금리·환산율·API와 지리 자료는 앞의 형식 표를 따른다.

### 주택 원문과 분리할 기능

계산기 `/calc/`와 보유세·연봉·저축 하위 화면은 사용자 입력과 계산 규칙을 사용한다.
주택 상세에서 넘긴 금액·면적은 계산 입력이며 전체 거래 자료를 읽는 이유가 아니다.
`/savings.html`은 `/calc/`로 이동하는 호환 URL이다. `/calc/savings.html`과 구분한다.

기업 `/div/`와 기업 상세는 `companysearch` 공개 자료를 사용한다. 주택 저장 계약으로
기업 파일을 통합하거나 다시 생성하지 않는다. `/board/`, `/account/`, `/admin/`은
회원·게시물·분석·운영 API가 중심이다. 아파트 이름·활동 링크에는 필요한 ID와 표시
정보만 사용한다. 이름 표시만을 위해 전체 거래 이력을 읽지 않는다.

## 2026-09-13 retired-output cleanup


Baseline commit: `ac9db9cbddb5bbe82e8a7b64b06f1cf1bc0435b1`.
The exact retired folders plus `data/index.json.bak` and `data/prices.json.bak`
contained 8,875 tracked files (119,653,655 bytes). Each local file's Git blob hash
was compared with the baseline before removal under the shared publication lock.
The candidate list `{path, hash, bytes}` JSON SHA-256 was
`2faefb042bfa676a877c0f7e7cbda913798ee57a726f1a183df633341e9d8804`.
Baseline 11,887 files / 427,570,073 bytes became 3,012 files / 307,916,418 bytes
before adding the validator, tests and documentation. Canonical earnings remained.
No backups were created; the baseline commit retains all removed contents.
