# 운영 전환 준비 현황 — 2026-09-13

## 현재 판단

사용자 기능 시험은 주요 흐름을 통과했다. 아직 DNS를 전환할 단계는 아니다.
기존 데이터 이관·회원 매핑·정방향/역방향 이관 도구는 계속 범위 밖이다.
운영 D1은 시험 D1을 복사하지 않고 빈 상태로 시작한다.

| 항목 | 확인 결과 / 남은 일 |
|---|---|
| 시험 배포 | 실행 #5 검사·배포 성공, 공개 SHA `24d50891ca0c8726e5c39b9679335962a6de4f97` |
| 실제 Worker | `c1e4667f-9f9b-4475-b49e-5237c6da1b48`, 스키마 1, 점검 모드 해제 |
| 주요 기능 | 사용자 직접 Google 로그인·닉네임·댓글·답글·추천·탈퇴·관리자 숨김/복원 확인. 태그는 에이전트가 실제 UI로 확인 |
| 탈퇴 후 답글 | 공개 API에서 부모 #6은 삭제 안내, 답글 #7은 정상 상태로 확인 |
| 배포 안전 검사 | 운영 계정·DB·호스트·요금제·인증·쓰기 승인 검사 추가. 타입 검사와 사이트 테스트 13개 통과 |
| 생성기 | companysearch 배포 시험 33개, 15_26 배포 시험 18개 통과. 가상 저장소·가상 네트워크 시험이며 실제 예약 배포 성공 증거는 아님 |
| 운영 DB·비밀 설정 | 준비 필요. 시험 DB를 운영에 연결하지 않음 |
| 실제 코드 복구 | 미실시. 아래 절차로 시험 환경에서 먼저 수행 |
| 알림 | 실제 GitHub 수신 미확인. 자동 비용 수집도 미구현 |
| 정식 로그인 | 운영 callback·홈페이지·개인정보·승인 도메인·Google 공개 상태 확인 필요 |
| 일정·DNS·과금 | 변경하지 않음 |

## 요금제 결정

2026-09-13 사용자 승인: **운영도 무료 플랜으로 시작한다.**
Workers 기본 CPU 제한을 사용하도록 운영 `limits.cpu_ms=50` 설정을 제거했다.
운영 환경 준비 시 `CLOUDFLARE_WORKERS_PLAN=free`를 등록하고 유료 승인 변수는 활성화하지 않는다.
현재 운영 DB placeholder와 인증/쓰기 차단은 유지한다. 무료 선택은 즉시 공개 전환 승인이 아니다.
향후 유료 전환이 필요하면 별도 승인 후 50ms 제한과 월 10달러 목표를 적용한다.
환경 변수는 운영자의 승인 기록이지 Cloudflare 실제 요금제 조회 결과가 아니다.
무료 초과가 자동 과금되는 것으로 안내하지 않으며 무료 제한에 따른 요청 실패 가능성을 안내한다.

근거: [Workers 가격](https://developers.cloudflare.com/workers/platform/pricing/),
[Workers 제한](https://developers.cloudflare.com/workers/platform/limits/).

## 실제 Worker 복구 시험 절차

1. 수집 작업과 시험 쓰기가 없는 짧은 검증 구간을 정한다. 활성 버전·자산 manifest·DB binding·스키마를 기록한다.
2. 현재 사용자 데이터의 **읽기 전용 기준값**을 기록한다. 이메일·Google 식별자·세션 토큰·댓글 본문은 기록하지 않는다.
   공개 댓글 #6/#7의 존재와 상태, 운영자 직접 로그인 유지, 태그 집계가 검증 대상이다.
3. 현재와 호환되는 버전 A와 B를 확보한다. 이전 `7eb5848c`는 삭제 부모 표시 정책이 달라
   새 정책의 복구 목표로 선정하지 않는다. 현재 코드 기반의 호환 버전을 먼저 배포한다.
4. Cloudflare에서 B → A로 **Worker 버전만** 복구하고, 공개 SHA·자산·로그인·기준값을 확인한다.
5. 사용자 시험 쓰기 1회가 정상인지 확인한다. 필요하면 B로 돌아간 뒤 다시 확인한다.
6. DB 되감기·DB 재생성·Supabase 복귀는 실행하지 않는다. 자산과 Worker 버전이 일치하지 않으면 공개 완료 처리하지 않는다.

Workers 버전은 코드·정적 자산·바인딩을 포함하지만 D1 데이터 변경 이력은 포함하지 않는다.
[공식 버전 안내](https://developers.cloudflare.com/workers/versions-and-deployments/),
[복구 안내](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

## 운영 배포 환경에 필요한 명시 설정

사용자 승인으로 `cloudflare-production` 환경을 생성했다. Required reviewers·Wait timer는 비활성,
허용 브랜치는 `main` 하나다. 시험 환경도 수동 승인 없이 `cloudflare-staging` 브랜치만 허용한다.
두 환경 모두 관리자 우회는 비활성이다. 운영 환경의 비밀 설정·활성화 변수는 아직 등록하지 않았다.
매회 배포 승인은 없지만 최초 공개 전환 확인은 별개로 유지한다. 배포 토큰은 DNS·결제 권한을 요구하지 않는다.

- `CLOUDFLARE_PRODUCTION_ENABLED=true`: 준비 완료 후 운영 배포 허용
- `NODESTREAM_DEPLOYMENT_PROVIDER=cloudflare`: 커밋의 provider 계약과 함께 전환
- `CLOUDFLARE_ACCOUNT_ID`: 승인 계정
- `CLOUDFLARE_PRODUCTION_D1_ID`: 새 빈 운영 DB ID, 시험 DB ID 및 0 placeholder 거부
- `CLOUDFLARE_WORKERS_PLAN=free|paid`: 사용자 선택
- `CLOUDFLARE_PAID_APPROVED=true`: 유료 선택 시에만 별도 승인 후
- `CLOUDFLARE_PRODUCTION_AUTH_APPROVED=true`: 정식 Google 설정·사용자 로그인 준비 후
- `CLOUDFLARE_PRODUCTION_WRITES_APPROVED=true`: 초기 관리자 준비·전환 확인 후

설정만 기록했다고 승인된 것으로 보지 않는다. 실제 자원·외부 승인·시점을 별도로 확인한다.
초기 운영은 `AUTH_ENABLED=false`, `MAINTENANCE=true`를 유지한다.
현재 staging 검사도 운영 인증/쓰기 비활성을 요구하므로, 운영 활성화 시 해당 검사 정책을 함께 검토해야 한다.

## 알림과 생성기 전환

- 실패 알림 시험은 의도적으로 실패하는 **전용 시험 실행**으로 수행하고 실제 수신을 사용자에게 확인한다.
  배포 실패를 유발하거나 서비스 장애를 만들지 않는다. 현재 알림 설정을 임의로 바꾸지 않는다.
- 현재 health workflow는 6시간 주기이므로 장애의 즉시 탐지를 보장하지 않는다.
- 비용 변수는 수동 예상치다. 자동 사용량·비용 수집 접근 권한과 모델 검증 없이는 7/9달러 자동 알림 완료로 표시하지 않는다.
- 예약 작업의 수집 범위와 시간을 유지한다. 전환 시 마지막 검증 문구만 배포 공급자 계약에 맞춘다.
- provider가 GitHub Pages인 현재는 기존 공개 검증 유지. 운영 전환 후 실제 기업·부동산 배포 각 1회를 검증한다.

## 다음 승인·확인 지점

무료 요금제 선택 완료 → 호환 버전 복구 시험과 알림 시험 → 빈 운영 DB·비밀 설정 준비 →
정식 Google 공개 설정 → 전환 시각 승인 → DNS/기존 쓰기 차단 → 운영 관리자 직접 지정 → 7일 관찰.

새 회원이 생긴 시점부터 D1을 보존하는 복구만 허용한다. 기존 Supabase 종료는 7일 후 별도 확인한다.
