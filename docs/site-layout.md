# Site layout and producer contract

Company data is owned by `companysearch`; apartment data is owned by `15_26`.
This repository contains public artifacts and their consumers, not a second company generator.

Run `node tools/verify-site-layout.mjs` before deployment. It checks the working tree,
including ignored retired company folders. `--staged` checks the Git index;
`--ref HEAD` checks a committed tree; `--source DIRECTORY` checks a prepared output
directory without requiring Git. `--root DIRECTORY` selects a different repository.
`--json` reports each path, byte size and content hash, plus a reproducible manifest hash.
Git snapshots use Git blob hashes; disk artifacts use SHA-256.

`--allow-existing-legacy` is audit-only and must never appear in a publish command.
Retired `data/div/` and `div/data/`, nested earnings directories and data backup/temp
files are forbidden. A duplicate-content count is informational, not authorization
to delete. Normal per-ticker `data/earnings/` files remain separate.

Both publishers acquire the first-byte OS lock in the Git common directory's
`nodostream-publish.lock`. The lock file is persistent and must not be removed;
its existence does not mean the lock is held. Apartment maintenance gates and its
existing release lock remain mandatory. Never stage another producer's changes.

The GitHub layout workflow is an additional check, not a claim that branch-based
Pages waits for its result. Local publication must validate before push. The final
exact commit must pass Pages, cache invalidation and normal public URL verification.
No DB backup is created by this workflow; committed static files are recoverable
with a reviewed revert commit. Uncommitted user changes must be preserved.

## 2026-09-13 retired-output cleanup

Baseline commit: `ac9db9cbddb5bbe82e8a7b64b06f1cf1bc0435b1`.
The exact retired folders plus `data/index.json.bak` and `data/prices.json.bak`
contained 8,875 tracked files (119,653,655 bytes). Each local file's Git blob hash
was compared with the baseline before removal under the shared publication lock.
The candidate list `{path, hash, bytes}` JSON SHA-256 was
`2faefb042bfa676a877c0f7e7cbda913798ee57a726f1a183df633341e9d8804`.
Baseline 11,887 files / 427,570,073 bytes became 3,012 files / 307,916,418 bytes
before adding the validator, tests and documentation. Canonical earnings remained.
No backups were created; the baseline commit retains all removed contents.
