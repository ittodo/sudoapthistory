# 만 14세 이상 자기확인

## 운영 반영 결과 — 2026-09-13

- 사용자가 모바일 정상 동작을 확인한 소스 `3e3d9b73eeeb8ace6a750ac8c3d08ac0874c0af8`를 운영에 반영했다.
- 운영 준비 workflow 변경 `3527e940`, 실행 `34742667851` 성공. Worker 버전 `460c5f03-bc92-4858-8ba3-530b9b9c9e4f`.
- 코드·자산만 갱신했다. DB migration/데이터 이관은 실행하지 않았다. 배포 전 정확한 스키마 2를 대조했고 배포 후 이력·스키마 2·사용자 관련 12개 테이블 0건·외래키 이상 없음·기존 secret 보존을 확인했다.
- 무료 플랜, AUTH_ENABLED=false, MAINTENANCE=true, workers.dev/preview 비활성, 맞춤 도메인 없음 유지. DNS 및 공개 운영 전환은 하지 않았다.

## 출처 오류 수정

두 번째 사용자 시험에서 첫 제출 후 이동 없음, 재제출 CSRF 오류 및 모바일 한글 깨짐이 보고됐다. `form-action 'self'`가 Google로 향하는 제출 후 redirect까지 차단할 수 있는데 첫 응답에서 연령 쿠키는 이미 제거되는 흐름이었다. 확인 화면의 form-action에 정확한 `https://accounts.google.com`만 추가하고 동일 출처·CSRF 검사는 유지한다. JSON 응답에 UTF-8 charset을 명시한다. 공개 확인기에 CSP 허용 목록 검사를, API 시험에 동일 정책과 한국어 오류 인코딩 검사를 추가한다. 자동 HTTP 검증은 실제 모바일 브라우저 상호작용 시험을 대체하지 않는다.

참고: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/form-action

최초 시험 배포 후 사용자가 ORIGIN 오류를 보고했다. 인증 경로 공통 `Referrer-Policy: no-referrer`가 네이티브 HTML 폼 POST의 Origin을 null로 만들어 서버 동일 출처 검사와 충돌했다. `/auth/google`의 GET 200 확인 화면만 `same-origin`으로 변경하고, Google 이동·callback은 `no-referrer`를 유지한다. null·빈 값·외부 Origin 허용 예외는 추가하지 않는다. API 시험과 공개 배포 확인기에 최종 응답 정책 검사를 추가했다. 기존 확인 화면은 새로 열어야 변경된 정책이 적용된다.

참고: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy

사용자가 선택한 방식: Google 로그인 전에 체크되지 않은 필수 확인란을 표시한다.
생년월일을 수집하거나 실제 연령을 인증하지 않는다. 거짓 선택을 막을 수는 없다.

- 일반 `/auth/google` GET은 확인 화면을 반환한다. POST는 동일 출처, 단기 보안 쿠키와 CSRF 값, 단일 `age14=yes`를 검사한다.
- 확인한 OAuth 요청의 서버 보관 nonce에 버전 접두사를 포함한다. callback에서도 확인 여부를 검사해 미확인 신규 회원 생성을 막는다.
- DB migration이나 사용자별 연령 정보 저장은 추가하지 않는다. 일반 로그인 때 다시 확인한다. 기존 로그인 세션을 강제 종료하지 않는다.
- 기존 세션에 연결된 탈퇴 본인 재확인은 예외다. 세션과 동일 Google 계정 검사는 유지한다. 탈퇴 대기 계정의 일반 로그인은 확인 후 기존 명시적 복구 흐름을 따른다.
- 배포 전 시작한 미확인 OAuth 요청은 로그인 재시작이 필요하다.
- 배포 확인기도 확인 화면을 검증하고 명시적으로 제출한 뒤 Google 이동 주소까지만 점검한다. 실제 Google 로그인이나 회원 생성은 하지 않는다.
- 개인정보처리방침 초안에 자기신고 한계와 확인용 쿠키를 반영한다. 만 14세 미만 가입 사실을 알게 된 경우의 처리 절차 등 공개 전 검토는 별도다.

검증: 미체크·위조 출처·쿠키 누락·과대 본문·미확인 OAuth callback 차단, 체크 후 OAuth 시작, 기존 가입·탈퇴·복구·권한 시험.

2026-09-13 로컬 검증 결과: 타입 검사 통과, API·보안 시험 16개 통과, 로그인 배포 확인기 시험 2개 통과, 정적 빌드 2,980개 파일 검증 통과.

2026-09-13 시험 배포 완료: 소스 `aae96cae`, GitHub Actions 실행 `34741879182`의 checks/deploy 성공. 공개 배포 검증과 연령 확인 화면 제출 후 Google 로그인 시작 검증 통과. 시험 주소는 https://nodostream-staging.sksk17.workers.dev 이며 실제 Google 계정 로그인은 자동 수행하지 않았다. 운영 Worker·도메인은 변경하지 않았다.
