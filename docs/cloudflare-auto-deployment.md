# 운영 자동 배포

> 문서 역할: **현재 지침** · [문서 목록](README.md)
> 지침을 먼저 읽고 구현·측정 근거는 뒤에서 확인합니다.


## 앞으로 지킬 배포·검증 규칙

운영 빌드는 현재 파일 해시와 검사 코드 지문을 확인한 PASS 증거를 재사용한다. 변경·누락·손상은 재검사한다. 매매·전월세 공통 거래는 지역·월, 상세는 각각 지역·연도와 지역·월 단위로 검사한다. 수동 workflow 실행과 한국 시간 일요일 실행은 `NODO_FULL_VERIFY=1`로 전체 의미 검사를 수행한다. 일반 코드 테스트와 동일 SHA·Worker·공개 manifest·공개 바이트 검증은 유지한다. 단계별 실제 시간은 CI artifact의 `build-timings.json`을 확인한다. 공식 생성기가 검토 산출물에 기록한 비공개 `data/.housing-validation.json`도 재사용한다. 검사 코드와 현재 manifest·참조 파일·상세 조각의 모든 바이트 해시가 일치해야 한다. 기록이 없거나 유효하지 않으면 전체 의미 검사 또는 기존 PASS 캐시 검사를 수행한다. 이 기록은 공개 자산에 포함하지 않는다.


- `main` push → Cloudflare Production: 운영 환경 검사 → 타입·기능·자산 검사 → Worker/정적 자산 배포 → 같은 SHA·manifest·공개 파일 해시·없는 JSON 404 확인 → Google 로그인 시작 확인.
- `cloudflare-staging` push → Cloudflare Staging: 시험 DB와 Worker만 사용한다. 운영 활성화 여부는 시험 대상 검사의 조건이 아니다.
- 운영 배포는 일반 DB migration, 데이터 초기화, secret 생성/교체를 하지 않는다. 현재 Production YAML에 명시된 승인된 board/member-library 테이블·키 검사는 고정된 대상과 검사 코드를 따르며, 기존 상태를 보존한다. 이 문서는 추가 스키마 승인이 아니다. 현재 D1과 기존 회원/관리자/세션을 보존한다. 스키마 변경은 별도 절차가 필요하다.
- 운영 `AUTH_ENABLED=true`, `MAINTENANCE=false`, `WITHDRAWAL_ENABLED=true`를 소스에 저장했다. 배포마다 임시 옵션으로 켜는 방식은 종료한다.
- Cloudflare Custom Domain과 www 리디렉션은 대시보드에서 관리한다. Wrangler `routes`/`route`는 지정하지 않는다. 설치된 Wrangler는 custom domain 목록이 비어 있으면 도메인 게시를 실행하지 않는다. 배포 후 실제 운영 도메인 접근으로 연결 보존을 검증한다. CI 토큰에 DNS·결제 권한을 추가하지 않는다.
- `tools/deployment-provider.json`과 저장소 변수 `NODESTREAM_DEPLOYMENT_PROVIDER`는 `cloudflare`다. 기존 Pages 완료 후 캐시 Purge 작업은 건너뛴다. GitHub Pages와 Supabase 자체는 아직 삭제하지 않는다.
- 무료 플랜 유지. 운영 환경은 `main`, 시험 환경은 `cloudflare-staging`만 허용한다. 수동 검토자·승인 대기 시간을 추가하지 않는다.
- 빈 DB·비공개 Worker를 전제로 했던 일회성 `cloudflare-prepare-production.yml`은 제거했다. Git 이력에서 확인 가능하며 공개 이후 재실행하지 않는다.
- 수집 일정과 공개 데이터는 이번 연결 작업에서 재생성하지 않는다. 생성기는 공통 provider 계약을 읽어 Cloudflare 공개 검증 경로를 사용해야 한다.
- 6시간 주기 Health는 별도 활성 변수로 켠다. 자동 비용 측정은 구현되어 있지 않으며 무료 플랜에 유료 가입이나 비용 차단을 추가하지 않는다.

운영 환경 변수: `CLOUDFLARE_PRODUCTION_ENABLED=true`, `CLOUDFLARE_PRODUCTION_AUTH_APPROVED=true`, `CLOUDFLARE_PRODUCTION_WRITES_APPROVED=true`, 기존 계정/D1 ID와 `CLOUDFLARE_WORKERS_PLAN=free`.

## 구현·검증 기록

최초 자동 배포 연결의 시험 `34747744688`, 운영 `34747848391`, Health `34747944425` 성공은 [2026-09-13 전환 기록](cloudflare-production-cutover-2026-09-13.md)에 보존한다. 현재 구현의 생성·검증 재사용과 실제 CI/공개 시간은 [워크플로우 실측](../../15_26/docs/workflow-redesign.md)을 따른다. 과거 실행 번호를 새 배포의 성공 증거로 재사용하지 않는다.
