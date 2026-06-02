# PolyGen 적용으로 nodostream 데이터 다운로드와 페이지 속도 개선 플랜

작성일: 2026-06-02

## 전제

여기서 `polygen`은 `D:\Rust\polygen` 프로젝트를 의미한다.

확인한 사실:

- `D:\Rust\polygen`은 `.poly` 스키마를 SSOT로 삼아 TypeScript/C#/Rust/C++/Go 코드를 생성하는 코드 생성기다.
- 현재 TypeScript 생성은 인터페이스, enum, Zod 검증을 지원한다.
- `.poly` 문법에는 `@load(csv/json)`, `@cache`, `@datasource`, `@pack`이 있다.
- CLI는 `cargo run -- generate --schema-path <schema.poly> --lang typescript --output-dir <dir>` 형태로 실행된다.
- `D:\asset\sudoapthistory`는 정적 HTML/JS/JSON 사이트이며 루트에 별도 빌드 파이프라인이 없다.

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
2. `D:\Rust\polygen`에서 TypeScript 산출물을 생성하는 명령을 문서화한다.

```powershell
cd D:\Rust\polygen
cargo run -- generate `
  --schema-path D:\asset\sudoapthistory\schemas\nodostream.poly `
  --lang typescript `
  --output-dir D:\asset\sudoapthistory\js\generated
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

로딩 순서:

1. `data/polygen/index.packed.bin`
2. 실패 시 `data/polygen/index.slim.bin`
3. 실패 시 기존 `data/index.json`

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

- `Build PolyGen index` 워크플로는 `ittodo/PolyGen`의 `gui-v0.1.8` Linux release asset을 다운로드한다.
- CI에서 `polygen generate`를 실행해 TypeScript binary ref 산출물을 재생성한다.
- `esbuild`로 `js/generated/browser/nodostream_binary_refs.js`를 만든다.
- `node tools/build-polygen-index.mjs`로 row-ref 바이너리와 packed 바이너리를 모두 생성한다.
- PR에서는 생성과 검증만 수행한다.
- `main` push에서는 `data/polygen/index.meta.json`, `data/polygen/index.packed.bin`, `js/generated/browser/nodostream_binary_refs.js`가 달라진 경우 bot 커밋으로 다시 push한다.
- GitHub Secrets에 `CF_ZONE_ID`, `CF_API_TOKEN`이 있으면 bot 커밋 후 Cloudflare에서 packed 인덱스 관련 URL을 purge한다.
- `data/polygen/index.slim.bin`, `data/polygen/index.slim.json`, TypeScript 중간 산출물은 git에서 제외한다. 배포 필수 파일은 packed 바이너리와 브라우저 fallback 번들만 추적한다.
