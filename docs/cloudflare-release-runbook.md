# Cloudflare 새 서비스 배포 실행서

현재 상태는 **무료 시험 배포 및 주요 사용자·관리자 기능 시험 완료, 운영 전환 준비 중**이다.
최신 확인과 미완료 항목은 [운영 준비 현황](cloudflare-production-readiness.md)을 따른다.
시험 D1 스키마와 Worker 배포·공개 검증은 성공했다. 시험 callback과 암호화 Secret이 적용돼 있다.
운영 DNS·운영 D1·요금제 및 기존 Supabase callback/키는 변경하지 않았다.
기존 Supabase 데이터는 가져오지 않는다. 기존 기업·부동산 공개 JSON과 수집 DB는 유지한다.

## 1. 안전한 시험 배포

- 이 변경을 운영 main에 바로 push하지 않는다. 기존 GitHub Pages가 main을 직접 배포하므로 새 API를 요구하는 화면만 먼저 공개하면 로그인·게시판이 깨진다.
- 구현 커밋은 `cloudflare-staging` 브랜치에만 push한다. 이 브랜치 push가 Staging workflow를 실행하며, main/Pages는 변경하지 않는다. workflow_dispatch는 기본 브랜치에 workflow가 등록된 뒤 사용할 수 있으므로 초기 배포는 push 트리거를 사용한다.
- 계정·요금제를 확인한다. 자동 유료 전환을 하지 않는다. 무료 staging에서 CPU 한도를 검증하고 유료 production 가입은 별도 승인을 받는다.
- 빈 staging D1은 생성 완료했다(`636d41b6-3ed7-4f6d-8f0b-823324c4ccad`). 중복 생성하지 않는다. SITE_ORIGIN은 계정의 Workers 하위 도메인에 따른 `https://nodostream-staging.sksk17.workers.dev`로 설정하고 실제 배포 후 검증한다. production binding은 별개로 남긴다.
- Staging workflow는 검사 성공과 환경 승인 이후, 고정된 시험 계정·DB·URL·브랜치·점검 모드를 검사한다. 로그인 활성화 시 승인된 Google client ID를 검사한다. 이 검사를 통과한 **기존 시험 DB에만** `wrangler d1 migrations apply nodostream-staging --remote`로 미적용 스키마를 적용한다. DB 생성·데이터 가져오기·운영 migration은 하지 않는다. Production workflow는 여전히 자동 migration하지 않는다.
- 공개 Google client ID는 시험 wrangler 설정에 기록하고 실제 비밀키는 Workers Secret으로만 등록한다. 채팅·Git·명령 기록에 실제 secret을 넣지 않는다. 기존 Google 프로젝트의 staging callback 및 Supabase callback을 함께 유지한다. 로그인 활성화 커밋 배포 후 자동 검사는 인증 시작까지만 확인하고, 실제 로그인은 사용자가 직접 수행한다.
- `cloudflare-staging` GitHub environment에 최소 권한 Cloudflare token, 계정 ID 및 staging origin을 설정한다. 환경 변수 `CLOUDFLARE_STAGING_ENABLED=true`를 배포 단계에서 검사한다. 승인 전에는 환경 변수를 읽을 수 없으므로 job 조건에서 이 값을 사용하지 않는다.
- 2026-09-13 연결: environment secret `CLOUDFLARE_API_TOKEN`, environment variables `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STAGING_ORIGIN`, `CLOUDFLARE_STAGING_ENABLED`. 환경 승인자는 `ittodo`이며 관리자 우회는 비활성화했다. 본인 실행의 본인 승인은 허용하므로 소유자가 시험 배포를 승인할 수 있다.
- 토큰 `nodostream-staging-github-actions`는 지정한 Cloudflare 계정의 `Workers Scripts:Edit`, `D1:Edit`만 포함한다. DNS·결제·R2·계정 관리 권한은 없다. **권한 범위는 특정 Worker/DB 하나가 아니라 해당 계정의 Workers·D1이다.** 만료일은 미지정이며 필요 종료 시 폐기/갱신한다. 토큰 원문은 GitHub 환경 secret에만 저장했고 로컬 파일·Git·채팅 출력에는 기록하지 않았다. 실제 API 인증 성공과 배포 성공은 아직 시험하지 않았다.
- `npm ci`, `npm run typecheck`, `npm run test:api`, `node --test tools/test-cloudflare-*.mjs tools/test-site-layout.mjs`, `npm run build`를 실행한다. build는 cloudflare/dist/public만 생성한다.
- 검증된 커밋을 시험 브랜치로 push하고 checks 성공 후 사용자가 GitHub의 Review deployments에서 승인한다. 같은 SHA health·manifest·대표 JSON/HTML 해시·없는 JSON 404가 성공해야 한다.
- 배포 완료 응답 직후에는 공개 반영이 늦을 수 있다. 공개 검증 CLI는 10초 간격 최대 7회, 전체 180초 안에서 전체 검사를 재시도한다. 지속적인 오류는 실패로 유지하며, 재시도 경고는 stderr에만 기록해 성공 artifact JSON에 섞이지 않는다. DB 재생성·초기화나 검증 생략으로 해결하지 않는다.
- health의 실제 Worker version_metadata ID도 확인해 Git SHA·자산 manifest 해시·DB schemaVersion과 함께 `verified-release.json` CI artifact에 기록한다. 로컬 placeholder 버전은 운영 검증 성공으로 인정하지 않는다.
- 운영용 HTML/JS는 자산 build에서만 deployment-version.js를 head 첫 부분에 넣는다. 동일 출처 data JSON GET에 배포 SHA query가 추가되며 원본 JSON 바이트는 바뀌지 않는다.

## 2. 운영 전환 체크리스트

운영 배포는 `verify-cloudflare-production.mjs`의 계정·빈 운영 DB ID·요금제·인증·쓰기
승인 검사를 통과해야 한다. 필요한 환경 변수는 운영 준비 현황 문서를 참조한다.

1. 사용자와 전환 시간·유료 승인·최초 관리자 계정을 확인한다. Google 공개 동의 화면과 개인정보 안내를 승인한다.
2. production D1을 **새로** 생성하고 binding ID를 설정한다. 빈 DB에 migration을 적용한다. production secrets와 Google callback `https://nodostream.com/auth/callback`을 등록한다.
3. 기존 Supabase 쓰기와 태그 자동 작성 경로를 차단한다. 확인되지 않은 쓰기 경로가 있으면 전환을 중지한다. companysearch tracked Go/Python/PowerShell 코드에는 Supabase 호출이 발견되지 않았으나 다른 서비스는 별도 감사한다.
4. 기존 GitHub Pages 자동 배포를 설정에서 중지한다. 이 단계는 repository YAML guard만으로 대체할 수 없다. 기존 Pages 공개 결과는 새 도메인이 준비될 때까지 유지한다.
5. 검토된 전환 커밋에서 tools/deployment-provider.json의 provider를 cloudflare로 변경한다. repository variable `NODESTREAM_DEPLOYMENT_PROVIDER=cloudflare`도 함께 활성화한다. 둘 중 하나만 바꾸면 새 배포는 진행되지 않거나 producer 공개 검증이 실패한다.
6. production Worker를 배포하고 nodostream.com custom domain을 연결한다. www는 별도 redirect rule로 nodostream.com에 보낸다. app.nodostream.com은 건드리지 않는다.
7. 기존 /data 장기 캐시 rule의 적용 호스트에서 nodostream.com을 제외하고 해당 도메인의 오래된 cache를 1회 제거한다. CDN HTML 주입도 해제하거나 검증된 새 해시와 일치함을 확인한다.
8. 기본 AUTH_ENABLED=false를 유지하다 사용자 bootstrap 준비 후 true로 변경한다. **MAINTENANCE=true여도 인증 활성화 후 첫 로그인부터 신규 회원이 생성되므로 이 시점부터 D1을 보존하는 복구만 허용한다.** 사용자 Google sub를 직접 확인한 후 명시 관리 명령으로 관리자 지정한다. MAINTENANCE=false 전환은 쓰기 재개 승인 후 수행한다.
9. Cloudflare Production 동일 SHA 성공, 공개 manifest/hash, 기업·부동산 예약 배포와 오전 브리핑을 확인한다. 기존 Purge workflow는 repository provider가 cloudflare일 때 중지하도록 별도 전환한다.
10. workspace-nightly-core의 마지막 완료 기준에 남은 고정 Pages/캐시 문구를 '해당 커밋의 배포 공급자 검증 및 공개 해시 일치'로 바꾼다. 일정·수집 범위·아침 브리핑 내용은 유지한다. 현재 예약 설정은 아직 변경하지 않았다.

## 3. 배포 계약과 복구

- producer는 배포 커밋의 tools/deployment-provider.json을 읽는다. github-pages는 기존 Pages/Purge workflow를 요구하고 cloudflare는 `Cloudflare Production` 성공과 /deployment.json, /api/health SHA를 요구한다. 다른 이름의 성공 실행으로 대체하지 않는다.
- provider의 기본값은 github-pages이며 계약이 없는 과거 커밋도 기존 방식으로 검증한다. 알 수 없는 값은 실패한다.
- 공개 JSON의 모든 변경 바이트 및 삭제 URL 확인, 회사/부동산 source gate, manifest 검토, 공유 잠금은 그대로 유지한다.
- 새 사용자 쓰기 전에는 기존 사이트로 복귀할 수 있다. 새 쓰기 이후에는 D1을 보존하고 호환 Worker 버전을 복구한다. Supabase 역이관 도구는 없다. DNS만 되돌리지 않는다.
- 심각한 오류 시 MAINTENANCE=true로 쓰기 중단 후 정적 사이트를 제공한다. D1 되감기는 자동 실행하지 않는다.
- 7일간 기존 Supabase를 유지한다. 기존 원본은 새 D1 백업이 아니다. 삭제는 별도 사용자 확인 후 한다.

## 4. 모니터링과 미완료 운영 검증

- `CLOUDFLARE_MONITOR_ENABLED=true`를 명시하기 전 Health workflow는 비활성이다. 활성 후 6시간마다 health/maintenance 확인한다. GitHub Actions 실패 알림의 실제 이메일 수신은 사용자 계정에서 시험해야 한다.
- `CLOUDFLARE_MONTHLY_ESTIMATE_USD`는 **운영자가 확인해 입력한 월 예상 금액**이다. 7/9달러 경고 수준을 검사할 뿐 Cloudflare 청구액을 자동 조회하지 않는다. 값이 없으면 unavailable로 표시한다. 자동 월 비용 산정·예측·실청구 수신은 아직 구현/검증되지 않았다.
- GitHub 기본 실패 알림은 반복 실패 시 반복될 수 있다. 비용 임계치 crossing별 중복 제거 알림·이슈 생성은 아직 활성화하지 않았다. 자동 결제 차단과 유료 전환은 없다.
- Worker 버전 기록 hook은 구현되어 있으나 실제 운영 ID 수신, 신규 데이터가 있는 복구 시험, 일반 사용자 Google 로그인, 관리자 지정, 실제 D1 마이그레이션, 이메일 수신, 7일 관찰은 실제 환경 준비 후 완료 표시한다.
