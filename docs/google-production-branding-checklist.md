# Google 운영 동의 화면 준비

2026-09-13. 등록 전 검토 문서이며 Google 설정을 변경한 기록은 아니다.

## 준비할 값

| 항목 | 준비값 / 상태 |
|---|---|
| 프로젝트 | nodostream, 기존·시험·운영 클라이언트가 공유 |
| 앱 이름 | nodostream.com |
| 홈페이지 | https://nodostream.com/ — 서비스 설명·개인정보 링크 보강 필요 |
| 개인정보 URL | https://nodostream.com/privacy.html — 제안 경로, 아직 생성·공개되지 않음 |
| 약관 | 없는 문서를 임의 링크하지 않음. policy.html은 부동산 정책이라 사용 금지 |
| 지원/개인정보 연락처 | sksk17@gmail.com — 기존 지원 주소 사용을 사용자 확인. 담당자 표시명은 사용자 지정 nodostream.com |
| 승인 도메인 | nodostream.com 등록 상태·소유권 최종 확인; 기존 도메인 임의 삭제 금지 |
| 운영 callback | https://nodostream.com/auth/callback 등록 완료 |
| 범위 | 현재 openid email profile; 추가 권한 불필요 |

## 실행 순서

1. privacy-policy-draft.md의 운영자·문의처와 미확정 항목을 확정한다.
2. 확정본만 privacy.html로 만들고 홈페이지·계정 화면에서 접근 가능하게 연결한다.
   미확정 초안은 docs에 유지하여 Workers 정적 배포에서 제외한다.
3. 시험 배포에서 페이지·링크를 검증한다. main은 아직 구서비스이므로 전체 시험 브랜치를
   무작정 합치지 않는다. 운영 URL에 공개할 경로·전환 전후 적용 범위를 따로 확인한다.
4. 동일 도메인에서 로그인 없이 개인정보 페이지가 실제 제공되는 것을 확인한 뒤
   Google Branding의 홈페이지·개인정보 URL·연락처·승인 도메인을 등록한다.
5. 도메인 소유권 및 브랜드 검증 필요 여부를 확인한다. 브랜드 검증/게시와 Audience의
   앱 게시 상태는 구분한다. 동의 화면 표시명이 도메인 연결만으로 즉시 바뀐다고 보장하지 않는다.
6. 공유 프로젝트의 게시/브랜딩 변경은 기존·시험 클라이언트에도 영향을 줄 수 있으므로
   해당 범위를 설명하고 승인 후 적용한다. 기존 키·callback은 삭제하지 않는다.
7. DNS/운영 인증/쓰기 전환은 별도 승인 단계에서 수행한다.

Google은 시험·운영의 프로젝트 분리를 권고한다. 현재 선택은 같은 프로젝트 내 클라이언트
분리이므로 비밀키는 분리되지만 브랜딩·Audience까지 격리된 상태는 아니다.
프로젝트 재분리는 이번 단계에서 임의로 실행하지 않는다.

근거: https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
