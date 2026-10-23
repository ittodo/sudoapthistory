# Member library and apartment analytics

> 문서 역할: **기능·구현 설명** · [문서 목록](README.md)
> 현재 운영·공개 자료 계약은 문서 목록의 기준 문서를 따릅니다. 날짜·건수·성능 수치는 해당 검증 조건의 기록입니다.


Approved scope: favorites and selected areas, one public heart per active member/apartment, regional rankings, transaction-to-calculator handoff and purchase-price adjustment, recent/saved calculations and comparison, own activity, anonymous administrator analytics. Search presets, notes/folders, stock bookmarks and notifications remain future work.

## Storage and API

- `0004_member_library.sql` adds favorites, areas, calculations, raw events and daily aggregates. Existing account and comment identities remain unchanged. User data is private and cascades on final account erasure; withdrawn accounts are excluded from hearts immediately.
- `/api/me/favorites`, `/api/me/calculations`, `/api/me/activity` require active sessions; writes reuse same-origin/CSRF/rate controls. Optimistic versions reject stale changes. Favorites and named calculations are capped at 200 per member. Areas never add extra hearts.
- `/api/apartments/hearts` accepts at most 100 IDs. `/api/apartments/ranking` filters region/district and pages 50 rows with rank ties. Public summaries are built from the same approved source identities and exclude cancelled/missing transactions.
- Calculator results are private versioned input/result snapshots. Recent slots are per calculation kind. A named save preserves the source trade, conditions and result; restore does not silently recalculate. Same-kind comparisons support 2–3 records.
- `/api/comments/focus` uses existing visibility checks and returns a selected comment plus its root. Own activity does not bypass moderation.

## Published apartment data

The browser and Worker use the same apartment entry and summary readers. See the [apartment data contract](apartment-and-board.md#단지-정보와-호환-url) for file contents and generation rules.

- The entry reader loads `data/apartments/entry-index.json`, then verifies and caches the selected entry bucket. Entry schema 3 stores common metadata and file hashes in the index. Each bucket contains only identity and region routes. The reader still accepts schema 2.
- The summary reader loads one of 256 `data/apartments/summary/<bucket>.bin` files. It verifies the hash, decompresses gzip, and opens the `PGRCD001` record index. It restores only the selected apartment. It keeps bounded file caches instead of shared decoded apartment objects. Existing JSON summaries remain readable.
- Favorite writes and apartment events use the Worker summary reader to check the published apartment ID and selected area. The schema 3 path does not load the national apartment catalog or detailed transaction files. Worker caches are separated by site origin and release SHA.
- Browser favorite summaries and administrator comment labels use `apartmentSummary(id)` from `js/apartment-records.mjs`. A legacy `apt_<row>` comment route can read the national JSON index to resolve its old row ID. Account activity loads that index only when the result contains apartment comments.

The summary files retain the existing recent-price values, cancelled-record rules, and area identities. Detailed sale and rental rows still come from the shared transaction files. Member ownership, write versions, limits, and heart counts keep their existing rules.

The producer uses a private packing cache. It reuses unchanged BIN bytes and does not rewrite unchanged files. Common dates and hashes do not need to be repeated in each entry bucket. Per-apartment date overrides, absent fields, and null values remain distinct.

The new BIN and entry schema 3 paths passed isolated fixture and API tests on 2026-10-23. That isolated validation did not run official native data generation, convert production data, or deploy a release. For production status, use the official run and CI and public checks for the same SHA in the [release record](../../15_26/docs/site-release-workflow.md).

## Anonymous analytics

`/api/apartments/events` accepts view, heart, trades and calculator events. It checks the same origin and published apartment/area. A 30-minute HttpOnly first-party visit cookie is hashed in event rows; no account identifier, email, raw IP or full referrer is stored. Repeated same-apartment/area/kind events within 30 minutes are deduplicated. Actions without a preceding same-session view are dropped. Source is attributed to the first same-day apartment view. Events are best-effort and not a billing or unique-person metric.

Daily Korean-time aggregates are updated atomically with events. `/api/admin/apartment-analytics` is administrator-only. Session totals over multiple days are sums of daily sessions. The existing hourly scheduled handler deletes raw events older than 30 days, preserving anonymous daily totals. Application privacy text describes these behaviors.

## Release

The production workflow verifies only the reviewed additive SQL using a fixed hash and pinned production target. It checks existing sqlite_master definitions and resumes an interrupted migration without dropping/recreating tables. The board-specific migration step remains separate. Stage the same commit first, then deploy production after tests and public-asset checks. On failure roll code back, never restore/rewind member data.

Validation includes API isolation, moderation, withdrawal deletion, retry/conflict behavior, analytics deduplication and retention, migration interruption/incompatible-schema refusal, actual calculator zero-principal/zero-rate behavior and price adjustments. Browser checks use an ephemeral local test account, never real production financial records.
