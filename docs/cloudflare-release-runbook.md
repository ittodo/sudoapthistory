# Cloudflare 운영 배포 실행서

> 문서 역할: **현재 지침** · [문서 목록](README.md)
> 지침을 먼저 읽고 구현·측정 근거는 뒤에서 확인합니다.


## 앞으로 지킬 실행 규칙

현재 사이트는 Cloudflare 운영 경로로 배포합니다. [자동 배포 계약](cloudflare-auto-deployment.md)과 커밋의 `tools/deployment-provider.json`, `.github/workflows/cloudflare-production.yml`을 확인합니다. 최초 전환·빈 운영 D1 생성·DNS 변경 절차를 반복하지 않습니다.

현재 배포 절차는 [공통 배포 기준](../../ops-dashboard/docs/deployment.md)을 따릅니다. 로컬 검사, 공통 잠금 아래 커밋·푸시, 같은 SHA의 CI 확인과 실패 재개를 그 문서에 둡니다.

## 자료 소유와 안전 경계

기업 수집·생성·공개는 companysearch, 부동산은 15_26이 소유합니다. 사이트는 소비 코드와 공개 자료를 보관합니다. 생성 자료는 각 공식 실행기의 검토한 run/manifest로만 공개합니다. [사이트 소유권](site-layout.md), [부동산 릴리스](../../15_26/docs/site-release-workflow.md)

배포는 기존 D1·회원·세션·승인을 보존합니다. 일반 DB migration·초기화·secret/DNS/요금제·예약 변경을 추가하지 않습니다. 현재 workflow의 명시 승인된 테이블/키 검사와 실제 동작은 YAML 및 검사 코드가 기준이며 정리 문서를 새 승인으로 사용하지 않습니다.

공개 검증은 CI가 수행하며 같은 커밋의 CI 성공 뒤 수동으로 반복하지 않습니다. 전체 자료 공개의 artifact ZIP/전부 바이트 증명은 [부동산 릴리스 계약](../../15_26/docs/site-release-workflow.md)을 유지합니다.

정적 배포만으로 리뷰 서버 재시작·DB 백업·수집을 수행하지 않습니다. 운영 장애 복구는 D1을 보존하는 호환 Worker/검토한 정적 수정 커밋으로 수행하며 자동 DB 되감기를 하지 않습니다.

## 과거 전환 기록

[2026-09-13 전환 기록](cloudflare-production-cutover-2026-09-13.md), [구현·검증 기록](cloudflare-implementation-status.md), [정리 전 최초 전환 실행서](archive/cloudflare-release-runbook.md)는 당시 상태와 근거입니다. 당시 미등록/미공개/승인 대기 문구를 현재 운영 상태로 해석하지 않습니다. 비용 자동 측정·유료 전환 완료를 이 문서 정리로 선언하지 않습니다.
