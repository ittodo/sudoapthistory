# Fresh-start Worker API

This implementation never imports existing Supabase users or content. Static financial/housing JSON stays intact. Migration `0001_initial.sql` is for a **new empty D1 database only**. Do not run it against an existing application database.

## Local verification

`npm ci --ignore-scripts`, `npm run typecheck`, `npm run test:api`. Tests bundle the actual Worker, initialize ephemeral Miniflare D1 from the SQL migration, and mock all outbound Google HTTP. No `.env`, production IDs, real accounts, source DBs, or network Google requests are needed.

After `npm run build`, `node cloudflare/dev-preview.mjs` provides a loopback-only integrated preview on port 8795 with fake data and outbound Google HTTP disabled. Its printed fake session is only for local UI testing. Stop it when inspection finishes; the ephemeral D1 is discarded.

`wrangler.jsonc` uses compatibility date 2026-08-01, supported by the pinned local workerd. Top-level settings represent the newly created empty free staging D1 database; its ID is a public resource identifier, not a credential. No remote schema or old data has been applied by this implementation. `--env production` selects a separate database whose committed ID remains a placeholder. Production CPU cap requires the approved paid plan; do not enable a paid plan automatically. Static assets are routed first, except `/api/*` and `/auth/*`; no SPA fallback. `www` redirection belongs to the zone redirect configuration, not this asset-first Worker.

## Safe startup and authentication

Defaults are `AUTH_ENABLED=false`, `MAINTENANCE=true`. Configure Google credentials through Worker secret facilities; never put secrets in vars, Git or logs. Set staging `SITE_ORIGIN` to its actual HTTPS origin.

`AUTH_ENABLED=true` allows Google login and **creates new production members even while MAINTENANCE=true**. This is the first new-data/rollback boundary. Maintenance still blocks profile/comment/tag/account writes; session reads work. Enable authentication for the operator's bootstrap login, assign the verified account explicitly, then enable public writes by setting `MAINTENANCE=false`. Turning authentication off blocks new OAuth exchanges but does not revoke existing sessions.

Google code flow uses PKCE S256, state bound to an HttpOnly cookie, 10-minute one-use database state, nonce/issuer/audience/expiry checks, and explicit RSA signature verification against Google's JWKS. First login creates a random internal UUID with role `user`. Email is not an account-merging key.

Account deletion requires a separate `/auth/google?reauth=1&returnTo=/account/` roundtrip, bound to the current session and same Google `sub`. It uses Google's `prompt=select_account`. Successful confirmation records a 10-minute `reauthenticated_at` on that same session. **This confirms the selected Google account; it does not promise that Google asked for a password again.** A different account or changed/expired session is rejected without replacing the original session. Real Google console callback and public-login checks remain required before production launch.

After the operator signs in, privately inspect the target user's ID and Google subject in the D1 admin console, then run `node cloudflare/admin.mjs --env staging|production --user UUID --google-sub VERIFIED_SUB --confirm-grant-admin`. The update requires both identities to match; verify exactly one returned row. There is no first-user-admin fallback or public role-assignment API.

## Browser contract

All API responses have `Cache-Control: no-store`. Errors are `{error:{code,message}}` and contain no internal SQL or credentials. Mutating requests require exact `Origin=SITE_ORIGIN`, a valid session, and `X-CSRF-Token` from `/api/session`; JSON bodies require `Content-Type: application/json` and are streamed with a 16KiB limit. The server derives ownership and admin role from the session.

- `GET /api/session`: `{session:{user:{id,email}}|null,profile,isAdmin,csrfToken}`.
- `GET /api/profile`: `{profile}`; `GET ?nickname=NAME`: `{available}`. `PATCH {nickname}`: `{profile}`. Names are 2–20 Korean/Latin letters, digits, `_` or `-`, case-insensitively unique.
- `POST /api/logout`; `DELETE /api/account`: `{ok:true}`. Deletion without current confirmation returns `REAUTH_REQUIRED`.
- `GET /api/comments?page_id=...&offset=0&limit=20`: `{data,count}`. Count refers to root comments. Rows include `profiles`, `comment_likes:[{count}]`, and `liked`. Root rows also include `reply_count`, `reply_preview_count`. Previews are up to 3 per root, reduced so the total response never exceeds 100 rows.
- `GET /api/comments/:id/replies?offset=...&limit=20`: `{data,count}`, at most 100 replies. Hidden/deleted roots are inaccessible along with their replies.
- `POST /api/comments {page_id,content,parent_id?}` and `PATCH /api/comments/:id {content}`: `{data}`. Creation requires a 16–100 character `Idempotency-Key` containing letters, digits, `_` or `-`; repeated keys with different content are rejected. `DELETE /api/comments/:id`: `{ok:true}`. Content limit is 1,000 characters; only one reply level is supported.
- `PUT /api/comments/:id/like {liked:boolean}`: `{ok,liked,count}`; repeats set the desired state.
- `GET /api/stocks/:ticker/tags`: `{data:[{id,tag_id,tags}],votes:{[tagId]:"up"|"down"}}`. `POST {name}` creates/reuses a case-insensitive unique 2–30-character name, links it to a six-digit ticker and adds the author's upvote in a single D1 batch. Repeats cannot duplicate these rows but consume rate quota.
- `PUT /api/tags/:id/vote {vote:"up"|"down"|null}`: `{ok:true}`.
- Admin: `GET /api/admin/stats`, `GET /api/admin/comments?status=all|normal|moderated|deleted&page_id=...&offset=0&limit=20`; `PUT /api/admin/comments/:id/moderation {hidden:true,category,detail}` or `{hidden:false}`. Deleted comments cannot be restored.
- `GET /api/health`: `{status:"ok",gitSha,workerVersionId,schemaVersion:1,maintenance}` after real table/column probes. A missing schema gives HTTP 500, not healthy status. `workerVersionId` is Cloudflare's version metadata binding; it is null only in local emulation without that binding. Remote deployment verification must require a nonempty ID.

Rate budgets are atomic fixed-window counters: 30 authenticated writes/user/minute and 20 tag proposals/user/UTC day. Rejected or repeated writes can consume the general budget. OAuth starts are limited to 20/IP/minute using a hash of the connecting IP. Expired sessions, OAuth state and counters are cleaned hourly in indexed batches of at most 1,000 rows per table. Monitor cleanup backlog if traffic exceeds these assumptions.

Account deletion erases authored text and identity references but keeps tombstone comment IDs to preserve other users' reply rows. Shared tags remain with a null author, and votes/likes cascade away; displayed counts are calculated from surviving rows rather than mutable cached counters.

## Rollback boundary

Keep new D1 data authoritative after authentication/public writes are enabled. Code rollback must keep the same D1 binding and compatible schema. No reverse migration or automatic D1 rewind exists. If rollback compatibility is uncertain, enable maintenance while keeping static assets available. Old Supabase's seven-day retention does not back up new D1 content.
