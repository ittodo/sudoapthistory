# 노도스트림 공개 사이트 작업 지침

공통 정책은 [전역 AGENTS.md](C:/Users/sksk1/.codex/AGENTS.md), 주제별 기준 문서는 [문서 목록](docs/README.md)을 따른다.
배포와 공개 확인은 [공통 배포 기준](../ops-dashboard/docs/deployment.md)과 [자동 배포](docs/cloudflare-auto-deployment.md)를 따른다.
에이전트 운영과 모델 매핑은 [서브에이전트 운영](../ops-dashboard/docs/agent-orchestration.md)과 `~/.claude/CLAUDE.md`를 따른다.

## Local calculator work

For changes limited to the holding-tax calculator, use `npm run verify:holding-tax`.
Do not run `npm run build` merely to verify calculator HTML/CSS/JavaScript changes:
the full-site build processes unrelated sale, jeonse and monthly-rent regional caches.

`build:holding-tax` packages only calculator files and shared UI dependencies into
`cloudflare/dist/holding-tax-local`. This is a local-only artifact, not a deployment
bundle, and must never replace `cloudflare/dist/public` or its deployment manifest.
The existing local preview (`npm run preview`) reads calculator sources directly;
editing or reloading the calculator does not require a full-site build.

Use the full-site build when explicitly required for a release or when changing
the full-site data/cache pipeline. Keep the normal release verification intact.

For salary calculator work, use `npm run verify:salary`. Its local-only output is
`cloudflare/dist/salary-local`; the same no-full-build and no-deployment rules apply.
Production releases use the existing main-push Cloudflare workflow. Commit and push
reviewed calculator source files so nightly publishers are not deferred by leftover
working changes. Preserve the shared Git publication lock and all release gates.

Local calculator commands are for development. During release, do not repeat checks that CI runs for the same commit. Follow the [shared deployment guide](../ops-dashboard/docs/deployment.md).
