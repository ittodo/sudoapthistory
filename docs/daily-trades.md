# 기간별 매매와 지도 재생

> 문서 역할: **기능·구현 설명** · [문서 목록](README.md)
> 현재 운영·공개 자료 계약은 문서 목록의 기준 문서를 따릅니다. 날짜·건수·성능 수치는 해당 검증 조건의 기록입니다.


## 앞으로 지킬 화면·자료 규칙

기간별 거래와 지도 재생은 공통 매매 자료의 번호표·거래·상태를 읽습니다. 단지 키에 지역을 포함하고 정확 면적을 유지합니다. 해제·사라짐 내역과 가격 계산 적격 여부를 구분합니다. 자료 manifest/버전/해시 불일치는 정상 결과로 표시하지 않습니다.

현재 공개 형식은 schema 3의 지역·분기 PGHOUSE1 거래와 지역·연도 PGSTATE1 상태입니다. 공개 과거 기준/overlay나 전역 번호 호환표를 새로 만들지 않습니다. [공통 저장 계약](../../15_26/docs/housing-packed-storage.md)

화면 요청은 선택 지역·기간에 필요한 자료만 읽고 완료 캐시를 재사용합니다. 오래된 응답이 새 날짜/조건 화면을 덮어쓰지 않도록 합니다. 조회 실패, 자료 갱신 중, 조건에 맞는 거래 없음은 서로 구분합니다.

## 구현과 검증 위치

- [일별 모델](../js/daily-model.js), [읽기 계층](../js/daily-client.js), [목록 화면](../js/daily-app.js)
- [지도 재생](../js/map-timeline.js), [재생 패널](../js/map-timeline-panel.js), [지도 조작부](map-timeline-overlay.md)
- [지역 자료 판독](../js/housing-regional.mjs), [상태 재생](../js/housing-state-timeline.mjs)
- [자료 검사](../tools/verify-daily-data.mjs), [모델 검사](../tools/test-daily-model.cjs), [클라이언트 검사](../tools/test-daily-client.cjs)

실행 방법은 package.json의 test:daily와 공식 생성기 [릴리스 계약](../../15_26/docs/site-release-workflow.md)을 따릅니다. 이 문서에 구현 소스를 복사해서 별도 버전으로 유지하지 않습니다. [정리 전 코드 사본](archive/daily-trades.md)은 당시 기록이며 실행 대상이 아닙니다.
