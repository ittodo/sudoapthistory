# 문서 목록

## 먼저 읽을 기준
운영은 [자동 배포](cloudflare-auto-deployment.md) → [배포 실행서](cloudflare-release-runbook.md) → [자료 소유권](site-layout.md) 순서로 읽습니다. 주택 공개 형식은 [생성 프로젝트의 저장 계약](../../15_26/docs/housing-packed-storage.md), 자료 생성·승인은 [부동산 릴리스](../../15_26/docs/site-release-workflow.md)가 기준입니다.

현재 지침, 기능·구현 설명, 과거 기록을 구분합니다. 오래된 명령·수치는 현재 실행 지침을 덮어쓰지 않습니다. 사실 충돌이 있으면 코드·검증 기록과 대조하고, 정책·승인 변경은 문서 정리로 대신하지 않습니다. 지침은 앞, 구현과 실제 검증 기록은 뒤에 배치합니다.

## 운영·배포

- [운영 자동 배포](cloudflare-auto-deployment.md)
- [Cloudflare 운영 배포 실행서](cloudflare-release-runbook.md)
- [Site layout and producer contract](site-layout.md)

## 주택 화면·자료 읽기

- [통합 아파트 상세와 공용 게시판](apartment-and-board.md)
- [공통 단지 자동완성](apartment-search.md)
- [기간별 매매와 지도 재생](daily-trades.md)
- [Desktop layout and rental publication](desktop-rent.md)
- [Apartment map](map-explorer.md)
- [지도 날짜 조작부 오버레이](map-timeline-overlay.md)
- [Regional historical prices](region-price-cache.md)
- [전월세 지도 UI와 성능](rental-map.md)
- [전월세 월간 시장 동향](rental-market.md)
- [시장동향 주담대 평균금리 비교](market-mortgage.md)

## 회원·통계·개인정보

- [회원 탈퇴 30일 유예·복구](account-withdrawal-google-design.md)
- [만 14세 이상 자기확인](age-confirmation.md)
- [Google 운영 동의 화면 준비](google-production-branding-checklist.md)
- [Member library and apartment analytics](member-library.md)
- [페이지 이용 통계](page-analytics.md)
- [nodostream 개인정보 처리방침 — 운영 검토 초안](privacy-policy-draft.md)
- [개인정보 비공개 초안 미리보기](privacy-preview.html)

## 계산기

- [보유세 비교표](holding-tax-calculator.md)
- [연봉·월급 계산기](salary-calculator.md)

## 과거 설계·검증·측정 기록

- [Cloudflare 구현·검증 기록](cloudflare-implementation-status.md)
- [Cloudflare 이전 — 기존 데이터 없이 새로 시작](cloudflare-migration-plan.md)
- [Cloudflare 운영 도메인 전환 기록](cloudflare-production-cutover-2026-09-13.md)
- [운영 전환 준비 현황 — 2026-09-13](cloudflare-production-readiness.md)
- [PolyGen 적용으로 nodostream 데이터 다운로드와 페이지 속도 개선 플랜](polygen-performance-plan.md)
- [개인정보 공개 전 결정 사항](privacy-release-decisions.md)
- [전월세 전체 탭 점검 (2026-09-20)](rental-tabs-audit.md)

## 정리 전 원문 보존

- [apartment-search.md 정리 전 기록](archive/apartment-search.md)
- [cloudflare-release-runbook.md 정리 전 기록](archive/cloudflare-release-runbook.md)
- [daily-trades.md 정리 전 기록](archive/daily-trades.md)
- [desktop-rent.md 정리 전 기록](archive/desktop-rent.md)

archive 문서는 실행 대상이 아닙니다. 당시 설명·실패·검증 근거를 보존하며 현재 자료나 공개 상태를 증명하지 않습니다. 삭제된 시험 산출물은 [파일 정리 기록](../../15_26/docs/file-cleanup.md)을 확인합니다. 원천 DB·백업·승인·비밀정보는 문서에 복사하지 않습니다.
