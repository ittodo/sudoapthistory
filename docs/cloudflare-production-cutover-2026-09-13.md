# Cloudflare 운영 도메인 전환 기록

확인 시각: 2026-09-13 17:08 KST. 이 기록은 도메인 전환 완료 기록이며 전체 마이그레이션 완료 선언이 아니다.

## 후속 완료 — 자동 배포 연결

아래 17:08 시점의 미완료 항목 중 자동 배포 연결·최초 관리자 지정·생성기 검증 연결·운영 점검 활성화는 완료했다.

- 소스 `4c9fd8477e488cb249e0e3e9a7a8c81a77a82af1` 시험 실행 `34747744688` 성공 후 동일 소스를 main으로 반영했다.
- 운영 자동 실행 `34747848391` 성공. 실제 공개 Worker `069a2e64-769b-4119-b019-0f32067e3a0a`, schema 2, manifest `257132094af8a9f45f02a9c30a2c525c12b87ea4a2dc8e0a19877d08b7dec4d2`를 독립적으로 대조했다. Google 로그인 시작 검사도 성공했다.
- 배포 후 기존 관리자 세션으로 `/admin/` 접근 성공. 회원·DB·secret을 초기화하지 않았다. 공개 데이터 파일 변경 없음.
- GitHub 운영 환경의 배포 활성/인증/쓰기 변수 true, 기존 free·계정·DB 변수와 token 유지. 저장소 provider cloudflare. 기존 Purge 실행 `34747848218`은 의도대로 skipped.
- `CLOUDFLARE_MONITOR_ENABLED=true` 등록. Health 첫 실행 `34747944425` 성공. 6시간 주기이며 즉시 장애 탐지나 자동 비용 측정을 의미하지 않는다. 실패 알림 수신은 앞선 전용 시험에서 사용자 확인한 상태다.
- 기업 확인기 시험 26개, 부동산 확인기 시험 18개 통과. 두 실제 확인기로 Cloudflare Production 성공과 동일 SHA 공개 JSON 해시 검증도 통과했다. 수집·재생성·새 데이터 publish는 하지 않았다. 다음 예약 수집 전체 실행의 성공 여부는 별도 관찰한다.
- 예약 작업이 사용하는 `D:/Work/sudoapthistory`를 깨끗한 `main`으로 전진 이동했다. 기업 preflight가 원격 main 일치를 확인했다. 시험 브랜치는 보존했다. 공통 배포 잠금과 수집 일정은 변경하지 않았다.
- 일회성 비공개 준비 workflow를 Git 이력에 보존하고 현행 파일에서 제거했다. 현재 자동 배포는 운영 DB migration과 DNS·결제 변경을 수행하지 않는다.

남은 관찰: 실제 예약 수집 전체 실행, 일반 운영 사용 흐름, 7일 보존 후 구 서비스 종료 여부 사용자 확인. 운영 DNS 전환이나 자동 배포 연결을 다시 실행할 필요는 없다.

## 실행 완료

- 사용자가 기존 GitHub Pages 대상 루트 A 레코드 4개 삭제를 직접 완료했다. 삭제 후 Cloudflare 화면에서 기존 A 레코드가 없는 것을 확인하고 `nodostream.com`을 운영 Worker `nodostream`의 Custom Domain으로 연결했다.
- Google OAuth 앱을 프로덕션 공개 상태로 전환했다. 운영 callback은 `https://nodostream.com/auth/callback`이다. 홈페이지와 개인정보처리방침 URL을 저장했다.
- `www`의 기존 CNAME만으로는 Worker 연결이 되지 않아 522가 발생했다. Single Redirect `nodostream www to primary`를 추가해 해결했다. `https://www.nodostream.com/*` → `https://nodostream.com/${1}`, 301이다. 경로와 쿼리 보존을 실제 응답으로 확인했다. HTTP 요청은 기존 HTTPS 이동 후 이 규칙을 따른다.
- 기존 `Data JSON - Long Cache`(edge 1년/browser 4시간), `HTML - Short Cache`(edge 1일/browser 10분)의 조건에 `and not (http.host in {"nodostream.com" "www.nodostream.com"})`를 추가했다. 새 사이트는 강제 캐시에서 제외하고 다른 호스트의 기존 정책은 보존했다. 두 규칙의 저장 완료를 확인했다.
- 공개 기업·부동산 데이터를 새로 수집하거나 재생성하지 않았다. 기존 Supabase 데이터를 복사하거나 삭제하지 않았다. `app.nodostream.com`, 등록 기관, 결제 플랜을 변경하지 않았다.

## 공개 검증

- Git SHA: `3bacc213fa2138da500cc793abddb81667d36c4a`
- Worker version: `fa3fb29e-4d3b-401d-80c6-b7bd8e86cae7`
- 배포 실행: `34746064671`
- `/api/health`: 200, status `ok`, schemaVersion `2`, maintenance `false`, 위 SHA/버전 일치, `Cache-Control: no-store`.
- `/`, `/privacy`: 200, `public, max-age=0, must-revalidate`. `/privacy.html`은 `/privacy`로 정상 이동한다.
- `/auth/google`: 200, 연령 확인 화면, `no-store`. OAuth 시작 응답의 운영 callback·Google client·PKCE를 확인했다. 실제 운영 사용자 로그인 완료를 의미하지는 않는다.
- `/data/earnings_index.json`, `/data/index.json`: 200, 재검증 Cache-Control 확인.
- 존재하지 않는 `/data/cutover-nonexistent-20260913.json`: 404.
- `https://www.nodostream.com/div/?audit=1`: 301 → `https://nodostream.com/div/?audit=1`.

## 남은 작업 — 다음 실행 전에 반드시 확인

1. **자동 운영 배포 전환은 아직 미완료다.** `tools/deployment-provider.json`은 `github-pages`이며, 저장된 `wrangler.jsonc` 운영 설정도 아직 인증 비활성/점검 모드다. 현재 공개 Worker는 준비 workflow의 명시적 배포 변수로 활성화한 버전이다. 기존 설정 그대로 재배포하면 안 된다.
2. 전체 Worker 코드를 main에 반영하고 운영 설정·staging 검사·provider 계약·GitHub 운영 활성화/인증/쓰기 승인 변수를 일치시켜야 한다. 시험과 운영 자동 배포를 각각 검증한다. DNS·결제 권한을 배포 토큰에 임의로 추가하지 않는다.
3. `cloudflare-prepare-production.yml`은 구 버전·빈 DB·비공개 상태를 전제한다. 공개 후에는 재실행하지 않는다. 신규 배포 경로 전환 시 이 준비 경로도 정리한다.
4. 최초 관리자 지정 완료: 사용자가 운영 로그인 완료를 알렸고, 운영 프로필의 닉네임 `운영자`와 D1의 활성 계정을 대조했다. 대상 계정과 권한을 설명한 뒤 사용자의 `진행해` 승인을 받았다. 회원 ID와 Google 식별자가 모두 일치하고 활성 일반 회원인 행만 관리자로 변경했으며 반환 행이 정확히 1개인 것을 확인했다. 실제 로그인 세션으로 `/admin/`의 통계·댓글 목록 접근도 확인했다(현재 댓글 0개). 이메일·Google 식별자·세션 정보는 이 공개 저장소 문서에 기록하지 않는다. 운영 댓글·태그 쓰기 흐름의 실제 사용자 확인은 남았다.
5. 기업·부동산 예약 배포의 Cloudflare 공개 검증, 운영 점검 알림을 확인한다. 기존 공개 데이터의 최신 재생성은 이번 요청에서 제외했다.
6. 기존 Supabase/Pages는 최소 7일 보존하고 2026-09-20 이후 사용자와 종료 여부를 결정한다. 자동 삭제나 D1 되감기를 실행하지 않는다. 새 쓰기 발생 후에는 D1을 유지하는 호환 Worker 복구만 허용한다.

기존 데이터 이관·회원 매핑·정방향/역방향 이관 도구는 계속 범위에서 제외한다.
