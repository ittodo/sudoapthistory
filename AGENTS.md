# Local calculator work

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
