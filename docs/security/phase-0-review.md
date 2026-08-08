# Security review — Phase 0 (2026-08-09)

Language: English | [中文](./phase-0-review-ZH.md)

Scope: control-plane file sandbox, public shares, WebDAV Basic, related crypto compares.

## Findings

| ID | Severity | Area | Status |
|----|----------|------|--------|
| P0-1 | High | FileManager `assertInside` used bare `startsWith(root)` | **Fixed** — boundary-safe prefix + null-byte reject |
| P0-2 | High | WebDAV accepted any Basic username if password matched | **Fixed** — username must be `ysk` |
| P0-3 | Medium | WebDAV / share password hash compare not constant-time | **Fixed** — `timingSafeEqual` / `safeHexEqual` |
| P0-4 | Medium | WebDAV path had no early `..` segment filter | **Fixed** — reject `..` segments before FileManager |
| P0-5 | Medium | Share passwords stored as unsalted SHA-256 | Accepted risk short-term; prefer scrypt/argon2 later |
| P0-6 | Low | WebDAV surface limited (no LOCK); PROPFIND unbounded listing | Documented; rate-limit / depth later |
| P0-7 | Info | CORS `*` on some public download responses | Intentional for public share clients; monitor |

## Residual / follow-up

- Prefer **scrypt/argon2** for share passwords and WebDAV token hashes (Phase 7 re-pass).
- Optional: rate-limit public share + WebDAV auth failures.
- Terminal / TOTP / API keys re-checked in Phase 7 after surface growth.

## Verification

- `packages/core` file manager + webdav unit tests updated and green.
EOF