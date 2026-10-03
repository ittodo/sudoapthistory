# PolyGen 적용으로 nodostream 데이터 다운로드와 페이지 속도 개선 플랜

## 현재 실행 지침: 변경 묶음 파일 소비 후보 (2026-10-04)

- 부동산 증분 처리 기준은 D:/Work/15_26/docs/incremental-cache-implementation-plan.md 앞부분과 [파일 소비 후보](../../15_26/docs/generation-file-batch-candidate.md)를 따른다. 아래 과거 구현·배포 설명을 현재 일상 실행 정책으로 해석하지 않는다.
- 변경분을 한 번 확정하고 같은 묶음을 운영 DB·계산·파일에 연결한다. 성공한 현재 후보·코드·입력·번호·출력 해시 근거를 재사용하며 같은 의미 대조를 매일 반복하지 않는다.
- 새로운 generationChangeBatchFiles 경로는 운영 OFF 후보다. 구간 시험 통과를 운영 전체 생성 또는 공개 완료로 보고하지 않는다. 기존 성능 미달 reuse_quarter_cache도 OFF를 유지한다.
- 후보는 지역/연도/분기 거래와 연간 월초 상태, 매매 지역·전월세 월별 상세를 각각 소비한다. 생성 실패는 소비 위치를 갱신하지 않는다. 후보 최종 검증 후의 소비 확정과 공개 승인은 별개다.
- 지역 전체 inventory 읽기와 운영 DB 지역 합/개수 저장은 아직 남아 있다. 필요한 구간만 시험하고 비용이 증가하면 멈춰 해당 구간을 수정한다. 기존 잠금·승인·백업·감사·공개 증명은 유지한다.


> 문서 역할: **과거 설계·검증 기록** · [문서 목록](README.md)
> 당시 상태와 근거를 보존합니다. 미완료 문구·명령·수치를 현재 운영 상태로 해석하지 않습니다.


현재 packed 공개 형식과 용량 실측은 [주택 저장 계약](../../15_26/docs/housing-packed-storage.md), 생성·검증 재사용은 [워크플로우 지침](../../15_26/docs/workflow-redesign.md)을 따릅니다. 아래 계획을 현재 공개 형식으로 해석하지 않습니다.

작성일: 2026-06-02

## 전제

여기서 `polygen`은 `polygen.lock.json`에 고정된 PolyGen 릴리스를 의미한다.

확인한 사실:

- `D:\Work\PolyGen`은 `.poly` 스키마를 SSOT로 삼아 TypeScript/C#/Rust/C++/Go 코드를 생성하는 코드 생성기다.
- 현재 TypeScript 생성은 인터페이스, enum, Zod 검증을 지원한다.
- `.poly` 문법에는 `@load(csv/json)`, `@cache`, `@datasource`, `@pack`이 있다.
- CLI는 잠금 파일로 해석한 실행 파일을 통해 `polygen generate --schema-path <schema.poly> --lang typescript --output-dir <dir>` 형태로 실행된다.
- `D:\Work\sudoapthistory`는 정적 HTML/JS/JSON 사이트이며 PolyGen 산출물은 GitHub Actions에서 재생성·검증한다.

이 플랜의 핵심은 polygen을 “런타임 다운로드 도구”로 쓰는 것이 아니라, nodostream 데이터 스키마와 타입/검증/로더를 생성하는 도구로 붙이는 것이다. 페이지 속도는 생성된 스키마를 기준으로 JSON을 더 작게 쪼개고, 첫 화면에서 필요한 데이터만 받게 만들어서 올린다.

## 현재 병목

### 큰 JSON 파일

현재 큰 공개 데이터 파일:

- `data/details.json`: 약 15.9 MB
- `data/index.json`: 약 12.7 MB
- `data/prices.json`: 약 4.4 MB
- `data/dividends.json`: 약 4.1 MB
- `data/complexes.json`: 약 3.6 MB
- `data/market.json`: 약 2.9 MB
- `data/volumes.json`: 약 2.4 MB
- `data/buybacks.json`: 약 1.7 MB

### 메인 페이지

`js/main-app.js:init()` 흐름:

1. `data/index.json`을 먼저 fetch한다.
2. 파싱 후 앱을 표시한다.
3. 이후 `loadPrices()`, `loadVolumes()`, `loadDetails()`, `loadGeo()`를 호출한다.

문제:

- 첫 화면에 꼭 필요하지 않은 상세/가격/거래량/좌표 데이터까지 이른 시점에 다운로드한다.
- JSON 파싱 비용도 네트워크 비용만큼 크게 먹는다.

### 비교 페이지

`compare/index.html`도 `../data/index.json`을 받고, 이후 동일하게 대형 데이터 로더를 호출한다.

문제:

- 비교 화면에서 실제 선택된 지역/단지만 필요한데 전역 데이터를 받는다.

### 시장 페이지

`market/index.html`은 다음처럼 매 방문마다 캐시를 무력화한다.

```js
fetch('../data/market.json?v=' + Date.now())
```

문제:

- Cloudflare와 브라우저 캐시가 재사용되지 않는다.
- 2.9 MB 파일을 반복 다운로드할 가능성이 높다.

## 목표 구조

polygen으로 nodostream 데이터 계약을 정의하고, 생성된 TypeScript 타입/Zod 검증/로더 보조 코드를 사용해 정적 데이터 구조를 아래처럼 바꾼다.

```text
schemas/
  nodostream.poly

js/generated/
  nodostream.ts 또는 nodostream.js
  nodostream.zod.ts

data/
  manifest.json
  index.slim.json
  details/
    <complexId>.json
  series/
    prices/<gu>.json
    volumes/<gu>.json
  market/
    summary.json
    full.json
    2026-05/1.json
  div/
    calendar/<year>.json
    company/<ticker>.json
```

## nodostream.poly 초안

```poly
namespace nodostream.apt {

    enum Region {
        Seoul = 1;
        Gyeonggi = 2;
        Incheon = 3;
    }

    @cache("full_load")
    @load(json: "data/index.slim.json")
    table AptIndexRow {
        id: u32 primary_key;
        name: string;
        region: Region;
        gu: string;
        dong: string?;
        area: f32;
        built_year: u16?;
        cagr: f32?;
        mdd: f32?;
        sharpe: f32?;
        trade_count: u32;
        household_count: u32?;
        land_share: f32?;
        latest_price: f32?;
        latest_date: string?;
    }

    @cache("on_demand")
    table AptDetail {
        id: u32 primary_key;
        address: string?;
        developer: string?;
        approval_date: string?;
        parking_count: u32?;
        floor_area_ratio: f32?;
        building_coverage_ratio: f32?;
    }

    @cache("on_demand")
    table AptSeries {
        id: u32 primary_key;
        prices: f32[];
        volumes: u32[];
    }

    table DataManifest {
        version: string primary_key;
        updated_at: string;
        index_path: string;
        market_summary_path: string;
    }
}
```

실제 스키마는 현재 `data/index.json`의 압축 배열 컬럼과 `js/main-app.js`의 필드 매핑을 기준으로 보정해야 한다.

## 적용 단계

### 1단계: polygen을 사이트에 “읽기 전용 생성 도구”로 연결

1. `schemas/nodostream.poly` 추가.
2. 잠금 파일의 버전과 SHA-256을 검증한 뒤 TypeScript 산출물을 생성한다.

```powershell
cd D:\Work\sudoapthistory
.\tools\generate-polygen-types.ps1
```

3. 산출물은 처음에는 런타임에 직접 import하지 않고, 타입/검증/스키마 문서로만 사용한다.
4. 현재 정적 사이트가 번들러 없이 동작하므로, polygen 산출물이 ESM/TS일 경우 바로 브라우저에 넣지 말고 다음 중 하나를 택한다.
   - `tsc`/번들 단계를 아주 작게 추가한다.
   - polygen에 `javascript` 또는 `browser-typescript` 템플릿을 추가해 plain JS/Zod 없는 검증 코드를 생성한다.

### 2단계: 빠른 캐시 개선

1. `market/index.html`의 `Date.now()` 캐시 버스터 제거.
2. `data/manifest.json`을 추가하고 `version` 기반 URL만 사용한다.
3. `js/data-loader.js`에 공통 `fetchJson(path, options)`를 만든다.
4. 동일 URL 중복 요청은 Promise 캐시로 합친다.

예상 효과:

- `/market/` 반복 방문 시 `market.json` 재다운로드를 크게 줄인다.
- 코드 변경 폭이 작고 위험도도 낮다.

### 3단계: 첫 화면 slim index 생성

1. 기존 `data/index.json`에서 첫 테이블 렌더에 필요한 필드만 `data/index.slim.json`으로 생성한다.
2. `js/main-app.js:init()`은 `index.slim.json`만 사용한다.
3. 기존 `data/index.json`은 한 배포 동안 fallback으로 남긴다.
4. polygen 스키마의 `AptIndexRow`로 `index.slim.json` 검증을 걸어 필드 누락을 조기에 잡는다.

예상 효과:

- 첫 화면 다운로드와 JSON parse 비용을 크게 낮춘다.

### 4단계: 상세/차트 데이터 on-demand shard 전환

1. `data/details.json`을 `data/details/<id>.json` 또는 `data/details/<gu>.json`로 분리한다.
2. `data/prices.json`, `data/volumes.json`을 `data/series/prices/<gu>.json`, `data/series/volumes/<gu>.json`로 분리한다.
3. detail modal, chart, compare 기능이 열릴 때만 해당 shard를 fetch한다.
4. polygen의 `@cache("on_demand")` 의미와 맞춰 loader 이름을 정한다.

예상 효과:

- 메인 페이지가 초기에 `details.json`, `prices.json`, `volumes.json`, `geo.json`을 받지 않아도 된다.
- 사용자가 실제로 클릭한 지역/단지의 데이터만 내려받는다.

### 5단계: polygen 템플릿 확장 여부 결정

현재 polygen TypeScript 템플릿은 일반 모델/Zod 생성에 초점이 있다. nodostream 페이지 속도를 더 직접적으로 개선하려면 polygen에 사이트 전용 템플릿을 추가하는 것이 좋다.

추가 후보:

1. `templates/nodostream-js/`
   - `fetchManifest()`
   - `loadIndexSlim()`
   - `loadDetail(id)`
   - `loadPriceSeries(gu)`
   - `loadVolumeSeries(gu)`
   - Promise dedupe cache
2. `templates/nodostream-schema-doc/`
   - 데이터 파일별 필드 문서 자동 생성
3. `templates/nodostream-validator/`
   - 배포 전 JSON 검증 스크립트 생성

이렇게 하면 데이터 구조 변경 시 `.poly` 하나만 고치고 타입, 검증, 로더 문서가 같이 따라온다. 작은 발전인데 꽤 단단한 발판이 된다.

### 6단계: 검증과 배포

검증 기준:

1. `/` 첫 로드에서 `details.json`, `prices.json`, `volumes.json`, `geo.json` 요청이 없어야 한다.
2. `/market/`에서 `Date.now()` 쿼리가 없어야 한다.
3. detail modal은 shard fetch 후 기존 UI와 같은 정보를 보여야 한다.
4. compare chart는 선택된 지역/단지 shard만 요청해야 한다.
5. generator를 두 번 실행했을 때 입력이 같으면 git diff가 없어야 한다.
6. Cloudflare purge는 `manifest.json`, 변경 shard, HTML만 대상으로 줄일 수 있어야 한다.

## 권장 작업 순서

1. `schemas/nodostream.poly`를 추가하고 polygen TypeScript 생성이 되는지 확인한다.
2. `market/index.html`의 `Date.now()` 제거와 `manifest.json` 도입을 먼저 한다.
3. `index.slim.json` 생성 스크립트를 만든다.
4. `js/main-app.js`를 slim index 기준으로 바꾼다.
5. 상세/가격/거래량 shard lazy load를 적용한다.
6. 마지막으로 polygen에 nodostream 전용 JS loader 템플릿을 추가한다.

## 결론

polygen은 다운로드 자체를 빠르게 만드는 마법 버튼은 아니지만, 데이터 계약을 고정하고 생성 로더/검증을 붙이는 데 딱 맞다. 먼저 polygen으로 스키마를 세우고, 실제 속도 개선은 JSON slim/shard/lazy-load/cache 정책으로 가져가는 방식이 가장 안전하다.

## 2026-06-02 구현 결과

이번 작업으로 `AptIndexRow` 스키마, TypeScript binary ref 생성, nodostream 빌드 스크립트, 브라우저 로더를 붙였다.

생성 파일:

- `schemas/nodostream.poly`
- `tools/generate-polygen-types.ps1`
- `tools/build-polygen-index.mjs`
- `tools/build-packed-index.mjs`
- `tools/build-polygen-browser.mjs`
- `tools/verify-polygen-index.ts`
- `tools/verify-polygen-packed-index.mjs`
- `js/polygen-index-loader.js`
- `js/polygen-packed-index-loader.js`
- `data/polygen/index.meta.json`
- `data/polygen/index.slim.json`
- `data/polygen/index.slim.bin`
- `data/polygen/index.packed.bin`
- `.github/workflows/build-polygen-index.yml`

현재 로딩 순서:

1. 수작성 컬럼형 포맷인 `data/polygen/index.packed.bin`
2. 실패 시 기존 `data/index.json`

PolyGen row-ref 형식인 `data/polygen/index.slim.bin`은 CI 검증용이며 현재 배포 런타임
fallback에는 포함하지 않는다.

크기 비교:

| 파일 | raw | gzip | brotli |
| --- | ---: | ---: | ---: |
| `data/index.json` | 12,736,083 | 2,065,536 | 1,451,245 |
| `data/polygen/index.slim.bin` | 11,804,986 | 2,761,543 | 1,764,896 |
| `data/polygen/index.packed.bin` | 4,951,284 | 1,343,631 | 994,731 |

결론:

- row-ref 바이너리는 구조 검증과 lazy getter에는 유용하지만, 전송량은 gzip/brotli 기준으로 원본 JSON보다 불리하다.
- nodostream 전용 packed 바이너리는 문자열 사전 + 컬럼형 typed array 구조라 전송량도 줄어든다.
- 현재 정적 사이트에서는 packed 바이너리를 우선 사용하고, row-ref 바이너리와 JSON을 fallback으로 유지한다.

GitHub Actions:

- `Build PolyGen index` 워크플로와 로컬 생성은 모두 `polygen.lock.json`을 읽는다.
- 현재 잠금 버전은 `gui-v0.1.9`이며, OS별 릴리스 자산의 SHA-256을 검증한 뒤 사용자 캐시에 설치한다.
- 개발 중인 소스를 시험할 때만 `POLYGEN_BIN`과 필요 시 `POLYGEN_ROOT` 또는 `POLYGEN_TEMPLATES_DIR`을 명시적으로 설정한다.
- CI에서 `polygen generate`를 실행해 TypeScript binary ref 산출물을 재생성한다.
- `esbuild`로 `js/generated/browser/nodostream_binary_refs.js`를 만든다.
- `node tools/build-polygen-index.mjs`로 row-ref 바이너리와 packed 바이너리를 모두 생성한다.
- pull request에서는 추적 중인 브라우저 번들·메타데이터·packed 바이너리가 재생성 결과와 다르면 실패한다.
- PR에서는 생성과 검증만 수행한다.
- `main` push에서는 `data/polygen/index.meta.json`, `data/polygen/index.packed.bin`, `js/generated/browser/nodostream_binary_refs.js`가 달라진 경우 bot 커밋으로 다시 push한다.
- `Purge Cloudflare` 워크플로는 `main` push마다 Pages 배포 완료를 기다린 뒤 Cloudflare purge를 실행한다.
- GitHub Secrets에 `CF_ZONE_ID`, `CF_API_TOKEN`이 있어야 purge가 성공한다.
- `Build PolyGen index`가 generated 파일 bot 커밋을 만들면 그 bot 커밋의 push도 `Purge Cloudflare`를 다시 실행한다.
- `data/polygen/index.slim.bin`, `data/polygen/index.slim.json`, TypeScript 중간 산출물은 git에서 제외한다. 배포 필수 파일은 packed 바이너리와 브라우저 fallback 번들만 추적한다.


## 2026-10-03 지역 저장 캐시 검증 재사용

운영 지침과 단계별 실측은 D:/Work/15_26/docs/incremental-cache-implementation-plan.md를 따른다. 동일 입력/코드/영구 번호와 현재 출력 해시가 모두 일치한 schema 2 PASS 영수증만 반복 의미 대조를 재사용한다. 구형 영수증과 변경 입력은 실제 대조를 수행하며 NODO_FULL_VERIFY=1은 전체 경로를 유지한다. 손상은 차단한다.

구현은 tools/housing-packing-cache.mjs와 build-housing-regions.mjs이며 재사용 횟수를 validationReused로 기록한다. 단일 공개 분기의 반복 대조 실측 중앙값 0.123239초에서 0.001774초로 감소했다. 전체 생성 속도나 분할 파일의 절감률은 아직 측정하지 않았다. tools/benchmark-housing-packing-validation.mjs는 30초 제한 읽기 전용 진단이며 보고서 출력은 공개 입력 외부로 지정한다.


## 2026-10-03 미변경 과거 연도 입력 해석 재사용

현재 지침은 D:/Work/15_26/docs/incremental-cache-implementation-plan.md의 과거 연도 포장 재사용 절을 따른다. 공개 연도 상태 파일을 함께 보존하므로 변경된 연도는 기존 분기 처리로 돌아가고 미변경 연도만 DTO 해석을 생략한다. tools/housing-year-cache.mjs는 입력/코드/경계·기존 영구 번호 및 실제 캐시 출력 해시를 확인한다. 새 번호는 뒤에 추가할 수 있고 기존 위치 충돌·손상은 안전한 생성 또는 차단으로 처리한다.

실제 지역 41360·2021년 12개월 구간 중앙값 0.653초 → 0.235초, DTO 호출 24 → 0, 출력 해시 차이 0. 최초 구축 2.819초는 별도다. 전체 생성 속도를 이 절감률로 추정하지 않는다. 실제 측정은 tools/benchmark-housing-year-reuse.mjs, 공식 계측은 packingReuse.years / monthsDecoded이다. 전체 생성 반복 대신 30초 제한 구간 시험을 사용했다.


## 2026-10-03 상세 생성 묶음 재사용

운영 지침은 D:/Work/15_26/docs/incremental-cache-implementation-plan.md의 상세 생성 재사용 절을 따른다. 매매는 지역·연도, 전월세는 원본 지역·월의 원본/공통 거래/코드가 같고 현재 출력 해시가 맞는 성공 영수증을 재사용한다. 기존 영구 번호와 원천 상태를 확인하고, 삭제된 월/연도 출력은 가져오지 않는다. 표시 사전과 공개 manifest는 현재 자료로 구성한다. 강제 전체 검사는 유지한다.

구현은 housing-detail-cache.mjs와 build-housing-sales.mjs / build-housing-details.mjs다. 공식 native 호출이 cacheDir을 공급하며 sales.reuse 및 details.reuse로 계측한다. 실제 공개 자료를 메모리로 복원한 동일 참조 생성 구간에서 매매 7,990건 168ms → 5.6ms, 전월세 2,533건 489ms → 10.3ms, 출력 바이트 차이 0. 전체 원문 읽기·index 재작성 및 전체 생성 시간은 이 비율에 포함되지 않는다. 근거는 benchmark-housing-detail-reuse.mjs와 외부 구간 보고서다.

### 2026-10-03 전월세 입력 목록의 지연 해석

운영 지침: tools/housing-contract-input.mjs의 목록은 PARSED 입력 정보이며 상세 PASS를 대체하지 않는다. 현재 원문 전체 해시, 현재 원천 연결, 실제 상세 성공 영수증·출력 해시 및 종료 입력 확인을 유지한다. 강제 전체 검사/캐시 미지정/상세 재생성 시 JSON을 해석한다. 로컬 목록은 Git/공개 자료에 넣지 않는다.

구현/실측: 공식 전월세 상세 경로는 미변경 월의 원천 ID 목록을 재사용하고 상세가 변경될 때만 JSON을 지연 해석한다. 용량 집계의 추가 원문 읽기도 제거했다. 격리 복원한 공개 41360·202609 자료(2,533건, 1,168,946B)의 입력 선택 구간 5쌍 중앙값 8.610ms → 3.062ms(64.44%), 최초 구축 11.240ms, 목록/건수/해시 차이 0. 전국/전체 상세 생성 시간으로 일반화하지 않는다. D:/Work/_ops/performance-replay/incremental-stage-v2/contract-input-segment.json에 근거를 남겼다. 주택 회귀 시험 38개 및 Worker 연동 통과. 운영 DB와 공개 데이터는 변경하지 않았다.

## 2026-10-03 계산·분기 포장 후보의 중단 기록

현재 실행 지침과 후보 테이블·실측·미완료 범위는 ../../15_26/docs/calculation-cache-candidate.md를 따른다. 새 분기 캐시는 기존 공개 경로와 schema를 유지하며 다른 분기 바이트를 재사용한다. 종로구 2025년 3,209행 시험에서 결과 해시 차이는 0이지만 중앙값 0.222206초 → 0.255674초로 약 15.1% 느려졌다. PERFORMANCE_STOPPED로 기록하고 공식 입력에서 reuse_quarter_cache를 공급하지 않는다. 파싱 보관 역시 reuse_native_inputs=true인 별도 후보이며 기본 보관 용량은 0이다. 기존 연도·상세 캐시는 이 실패를 이유로 새 성공이나 전체 운영 개선으로 보고하지 않는다.


2026-10-03 최종 검토에서는 비활성 분기 후보의 save 인자 구성에서 발생하던 불필요한 출력 읽기를 제거했다. 주택 native 재사용 회귀 4개 PASS. 같은 종로구 구간 최종 중앙값은 기존 0.229059초/후보 0.252751초로 약 10.3% 느려 PERFORMANCE_STOPPED를 유지했다. 첫 시험 15.1% 기록은 quarter-benchmark.before-inactive-guard.json에 보존한다. 운영 활성화나 전체 prepare·공개를 추가 수행하지 않았다.


## 2026-10-04 변경 묶음 파일 소비/ack 후보

공식 운영 트랜잭션의 generation_file_batch와 현재 producer 자료 해시·생성 코드·영구 번호를 결합해 파일 소비를 연결했다. Node는 비공개 pending만 저장하며 최종 후보 검증을 마친 공식 Rust prepare가 같은 run/seq/revision/engine의 소비 위치만 확정한다. 공개 data 또는 CI 자산에 소비 기록을 넣지 않는다. 후보 OFF에서는 새 소비 세션과 분기/상태 지문 계산을 하지 않는다.

기존 분기 후보의 private opening.bin 재압축/해석 비용을 반복하지 않고 공개 분기와 연간 월초 상태 바이트의 소비를 나눴다. 고정 41360 지역 2020·2021 입력, 서로 다른 과거 정정 3회, 독립 캐시 비교에서 미변경 0.246502→0.143987초(41.6%), 과거 정정 1.052814→0.698673초(33.6%)였다. DTO 호출 24→6, native 입력 읽기 96→12, 모든 파일 및 daily/rental manifest의 실제 바이트 차이 0. 최초 구축과 코드 근거 준비는 별도로 기록했고 전체 시간으로 환산하지 않는다.

주택 회귀 45개와 Worker/브라우저 통합 시험을 통과했다. 실제 구현·실패 측정 보존·운영 OFF·남은 전체 inventory 및 상세 읽기 범위는 D:/Work/15_26/docs/generation-file-batch-candidate.md, 최종 수치는 D:/Work/15_26/_ops/generation-file-batch/20261004/packing-segment-final.json을 따른다.
