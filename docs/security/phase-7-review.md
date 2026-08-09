# Security review — Phase 7 (2026-08-09)

Language: English | [中文](./phase-7-review-ZH.md)

Scope: re-pass after Tier-2 i18n, CLI parity, About UX, and public share / WebDAV surfaces.

## Findings

| ID | Severity | Area | Status |
|----|----------|------|--------|
| P7-1 | Medium | Share passwords stored as unsalted SHA-256 | **Fixed** — new shares use `scrypt$salt$hash`; legacy SHA-256 still verified |
| P7-2 | Medium | Public share password guesses unlimited | **Fixed** — rate limit `share-auth` (10 fails / 15m → 15m lock) per IP+token |
| P7-3 | Medium | WebDAV Basic auth failures unlimited | **Fixed** — rate limit `webdav-auth` per IP |
| P7-4 | Low | `pathAllowed` empty root / bare `/` edge cases | **Fixed** — empty roots ignored; `/` only allows exact `/` |
| P7-5 | Low | page chrome gate skipped guest / re-export pages | **Fixed** — SKIP list + SoftwareHub `status=` chrome |
| P7-6 | Info | WebDAV token remains SHA-256 of high-entropy secret | Accepted — random 24-byte token; not a user password |
| P7-7 | Info | CORS `*` on public download | Unchanged intentional for guest clients |

## Residual / follow-up

- Optional fail2ban jail for share/WebDAV 401/429 (ops doc).
- Rotate legacy share password hashes on next password set (already scrypt for new shares).
- PROPFIND depth / listing size caps when WebDAV usage grows.

## Verification

- `pnpm --filter @ysk/core test` (sandbox, shares, webdav)
- `pnpm chrome:check` / `pnpm gates` (i18n + chrome)
- Shared unit tests for `normalizeLocale` Tier-2 + RTL

## Related

[phase-0-review.md](./phase-0-review.md) · [overview.md](./overview.md)
