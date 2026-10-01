# Desktop layout and rental publication

> 문서 역할: **기능·구현 설명** · [문서 목록](README.md)
> 현재 운영·공개 자료 계약은 문서 목록의 기준 문서를 따릅니다. 날짜·건수·성능 수치는 해당 검증 조건의 기록입니다.


Housing navigation omits the two legacy entry points; their URLs still work. Apartment detail adds `tab=rent` with `rentType`, `rentPeriod`, `rentArea` query parameters. Grouped areas use `group:85`; table areas remain exact. Rent filters do not change the identity used for favorites, comments, or calculators.

`css/responsive.css` applies the 1600px desktop container, 32px gutters, 1200px desktop and 768px mobile boundaries. Shared shell rearranges existing calculator and account nodes while retaining IDs and event handlers.

## 현재 자료 읽기

아파트 전월세 상세는 지역·분기 공통 거래를 참조합니다. 아파트 원문 복제·data/apartment-rent 재생성은 하지 않습니다. 연립·오피스텔의 별도 계약 자료는 유지합니다. 이름 추측으로 연결하지 않으며 미수집·연결 미확정·빈 결과·다운로드 실패를 구분합니다. [저장 계약](../../15_26/docs/housing-packed-storage.md)

[상세 판독](../js/housing-contract-detail.mjs), [공통 계약](../js/housing-contracts.mjs), [상세 검사](../tools/verify-housing-details.mjs)가 현재 구현입니다. 생성은 [공식 부동산 릴리스](../../15_26/docs/site-release-workflow.md)에서 수행하고 사이트 빌드는 현재 해시와 검사 증거를 확인합니다.

## 검증과 과거 기록

정확 면적·월 경계·번호 참조·조건 변경·오래된 응답을 검사합니다. 기존 계정/API/계산기 기능은 유지하며 운영 브라우저 점검은 읽기 전용입니다. [이전 rebuild 절차](archive/desktop-rent.md)는 원문 복제 시절 기록입니다.
