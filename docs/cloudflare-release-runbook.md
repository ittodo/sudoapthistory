# Cloudflare 운영 배포 실행서

> 문서 역할: **현재 지침** · [문서 목록](README.md)
> 지침을 먼저 읽고 구현·측정 근거는 뒤에서 확인합니다.


## 앞으로 지킬 실행 규칙

현재 사이트는 Cloudflare 운영 경로로 배포합니다. [자동 배포 계약](cloudflare-auto-deployment.md)과 커밋의 `tools/deployment-provider.json`, `.github/workflows/cloudflare-production.yml`을 확인합니다. 최초 전환·빈 운영 D1 생성·DNS 변경 절차를 반복하지 않습니다.

1. 사이트 AGENTS와 Git 상태·staged 변경·원격 main 및 미푸시 범위를 확인합니다. 이번 검토 파일만 명시하고 다른 작업의 변경·커밋을 섞지 않습니다.
2. 변경 범위에 맞는 로컬 검사와 `node tools/verify-site-layout.mjs`를 수행합니다. 문서나 계산기 화면 확인만을 위해 대용량 전체 빌드를 반복하지 않습니다. 운영 CI 전체 검사·정식 빌드는 유지합니다.
3. Git common directory의 `nodostream-publish.lock` 첫 바이트 OS 잠금 아래 상태를 재확인하고 명시 파일만 stage합니다. `git diff --check`, `node tools/verify-site-layout.mjs --staged`와 staged 목록을 검토한 뒤 commit·정상 main push를 수행합니다. 잠금 파일 삭제·force·자동 rebase/reset·blanket add는 금지합니다. push 후 잠금을 해제합니다.
4. 정확한 SHA의 Cloudflare Production push/main 성공을 확인합니다. 실패·응답 유실은 HEAD·원격·CI부터 확인하고 같은 커밋으로 재개합니다. 다른 SHA나 Staging/Pages 성공으로 대체하지 않습니다.
5. `tools/verify-cloudflare-deployment.mjs` 계약에 따라 deployment·health SHA, 실제 Worker 버전, manifest digest, 대표 공개 바이트와 없는 JSON의 404를 확인합니다. 변경한 공개 자산도 해시를 확인합니다. 문서는 공개 자산이 아니므로 문서 URL을 성공 기준으로 삼지 않습니다.
6. 최종 Git 상태·로컬/원격 SHA·잠금 해제를 기록합니다. CI 진행 중이나 public proof 실패는 완료가 아닙니다.

## 자료 소유와 안전 경계

기업 수집·생성·공개는 companysearch, 부동산은 15_26이 소유합니다. 사이트는 소비 코드와 공개 자료를 보관합니다. 생성 자료는 각 공식 실행기의 검토한 run/manifest로만 공개합니다. [사이트 소유권](site-layout.md), [부동산 릴리스](../../15_26/docs/site-release-workflow.md)

배포는 기존 D1·회원·세션·승인을 보존합니다. 일반 DB migration·초기화·secret/DNS/요금제·예약 변경을 추가하지 않습니다. 현재 workflow의 명시 승인된 테이블/키 검사와 실제 동작은 YAML 및 검사 코드가 기준이며 정리 문서를 새 승인으로 사용하지 않습니다.

HTML은 정식 빌드의 deployment-version 삽입 바이트와 manifest를 대조합니다. 관찰된 CDN 추가분은 정확한 원인을 구분하며 광범위한 정규화나 HTTP 200만으로 해시 검사를 대체하지 않습니다. 전체 자료 공개의 artifact ZIP/전부 바이트 증명은 [부동산 릴리스 계약](../../15_26/docs/site-release-workflow.md)을 유지합니다.

정적 배포만으로 리뷰 서버 재시작·DB 백업·수집을 수행하지 않습니다. 운영 장애 복구는 D1을 보존하는 호환 Worker/검토한 정적 수정 커밋으로 수행하며 자동 DB 되감기를 하지 않습니다.

## 과거 전환 기록

[2026-09-13 전환 기록](cloudflare-production-cutover-2026-09-13.md), [구현·검증 기록](cloudflare-implementation-status.md), [정리 전 최초 전환 실행서](archive/cloudflare-release-runbook.md)는 당시 상태와 근거입니다. 당시 미등록/미공개/승인 대기 문구를 현재 운영 상태로 해석하지 않습니다. 비용 자동 측정·유료 전환 완료를 이 문서 정리로 선언하지 않습니다.
