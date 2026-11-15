# 문서 목록

## 먼저 읽을 기준
배포 작업은 [공통 배포 기준](../../ops-dashboard/docs/deployment.md)에서 시작합니다. CI·캐시 계약은 [자동 배포](cloudflare-auto-deployment.md), 자료 역할은 [자료 소유권](site-layout.md)을 따릅니다. 페이지의 탭·모드별 자료 역할과 읽기 범위는 [페이지 기능별 데이터 사용 계약](site-layout.md#페이지-기능별-데이터-사용-계약)이 기준입니다. 주택 공개 형식은 [생성 프로젝트의 저장 계약](../../15_26/docs/housing-packed-storage.md), 자료 생성·승인은 [부동산 릴리스](../../15_26/docs/site-release-workflow.md)가 기준입니다.

현재 지침과 기능·구현 설명을 구분합니다. 오래된 명령·수치는 현재 실행 지침을 덮어쓰지 않습니다. 사실 충돌이 있으면 코드·검증 기록과 대조하고, 정책·승인 변경은 문서 정리로 대신하지 않습니다. 지침은 앞, 구현과 실제 검증 기록은 뒤에 배치합니다. 완료된 이전·전환·감사·성능 측정 기록과 정리 전 원문은 이 목록에 두지 않으며 Git 이력에서 확인합니다.

## 운영·배포

- [공통 배포 기준](../../ops-dashboard/docs/deployment.md)
- [운영 자동 배포](cloudflare-auto-deployment.md): CI·캐시 계약, Worker·API 계약과 롤백 경계, 네이티브 투영 CI(`cloudflare/`·`tools/native-projection/`의 진입 안내가 가리키는 절)
- [자료 소유권과 페이지 기능별 데이터 사용 계약](site-layout.md): 반응형 경계, 전월세 상세 진입, 가격대 세대수·거래 회전율, 화면별 로딩 기준치 포함

## 주택 화면·자료 읽기

- [통합 아파트 상세와 공용 게시판](apartment-and-board.md): 공통 단지 자동완성·검색 자료 포함
- [Apartment map](map-explorer.md): 기간별 실거래, 지도 날짜 조작부, 전월세 지도, 지역 과거 가격 캐시 포함
- [전월세 월간 시장 동향](rental-market.md): 주담대 평균금리 비교 포함

## 회원·통계·개인정보

- [회원 운영](account-withdrawal-google-design.md): 탈퇴 30일 유예·복구, 만 14세 이상 자기확인, 회원 보관함, 단지·페이지 이용 통계
- [개인정보 비공개 초안 미리보기](privacy-preview.html)

## 계산기

- [보유세 비교표](holding-tax-calculator.md)
- [연봉·월급 계산기](salary-calculator.md)
