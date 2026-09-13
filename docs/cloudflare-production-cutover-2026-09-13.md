# Cloudflare 운영 도메인 전환 기록

확인 시각: 2026-09-13 17:08 KST. 이 기록은 도메인 전환 완료 기록이며 전체 마이그레이션 완료 선언이 아니다.

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
