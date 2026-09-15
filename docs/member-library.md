# Member library and apartment analytics

Approved scope: favorites and selected areas, one public heart per active member/apartment, regional rankings, transaction-to-calculator handoff and purchase-price adjustment, recent/saved calculations and comparison, own activity, anonymous administrator analytics. Search presets, notes/folders, stock bookmarks and notifications remain future work.

## Storage and API

- `0004_member_library.sql` adds favorites, areas, calculations, raw events and daily aggregates. Existing account and comment identities remain unchanged. User data is private and cascades on final account erasure; withdrawn accounts are excluded from hearts immediately.
- `/api/me/favorites`, `/api/me/calculations`, `/api/me/activity` require active sessions; writes reuse same-origin/CSRF/rate controls. Optimistic versions reject stale changes. Favorites and named calculations are capped at 200 per member. Areas never add extra hearts.
- `/api/apartments/hearts` accepts at most 100 IDs. `/api/apartments/ranking` filters region/district and pages 50 rows with rank ties. Public summaries are built from the same approved source identities and exclude cancelled/missing transactions.
- Calculator results are private versioned input/result snapshots. Recent slots are per calculation kind. A named save preserves the source trade, conditions and result; restore does not silently recalculate. Same-kind comparisons support 2–3 records.
- `/api/comments/focus` uses existing visibility checks and returns a selected comment plus its root. Own activity does not bypass moderation.

## Anonymous analytics

`/api/apartments/events` accepts view, heart, trades and calculator events. It checks the same origin and published apartment/area. A 30-minute HttpOnly first-party visit cookie is hashed in event rows; no account identifier, email, raw IP or full referrer is stored. Repeated same-apartment/area/kind events within 30 minutes are deduplicated. Actions without a preceding same-session view are dropped. Source is attributed to the first same-day apartment view. Events are best-effort and not a billing or unique-person metric.

Daily Korean-time aggregates are updated atomically with events. `/api/admin/apartment-analytics` is administrator-only. Session totals over multiple days are sums of daily sessions. The existing hourly scheduled handler deletes raw events older than 30 days, preserving anonymous daily totals. Application privacy text describes these behaviors.

## Release

The production workflow verifies only the reviewed additive SQL using a fixed hash and pinned production target. It checks existing sqlite_master definitions and resumes an interrupted migration without dropping/recreating tables. The board-specific migration step remains separate. Stage the same commit first, then deploy production after tests and public-asset checks. On failure roll code back, never restore/rewind member data.

Validation includes API isolation, moderation, withdrawal deletion, retry/conflict behavior, analytics deduplication and retention, migration interruption/incompatible-schema refusal, actual calculator zero-principal/zero-rate behavior and price adjustments. Browser checks use an ephemeral local test account, never real production financial records.
