# Security hardening — Phase S2 (public surface + SSRF + headers)

Language: English | [中文](./phase-s2-hardening-ZH.md)

## Findings

| ID | Severity | Area | Status |
|----|----------|------|--------|
| S2-1 | Medium | CORS `*` on all JSON | **Fixed** — no `*`; optional `YSK_CORS_ORIGIN` |
| S2-2 | Medium | Public `/api/v1/status` leaked dataDir/execute/tools | **Fixed** — public subset only; full when authed |
| S2-3 | Medium | Share password in query string | **Mitigated** — prefer `X-Share-Password` header (query still accepted) |
| S2-4 | Medium | Webmail SSO consume unlimited | **Fixed** — rate limit by IP |
| S2-5 | High | CDN/LLM SSRF to IMDS | **Fixed** — `assertSafeOutboundUrl` (metadata vs strict policies) |
| S2-6 | Medium | Missing security response headers | **Fixed** — nosniff, frame, referrer; optional HSTS |
| S2-7 | Low | Static UI without baseline headers | **Fixed** — nosniff / SAMEORIGIN on SPA |
| S2-8 | Info | Install checksum pin | **Documented residual** — still Phase residual I-07 |

## Operator notes

| Env | Effect |
|-----|--------|
| `YSK_CORS_ORIGIN=https://panel.example.com` | Allow that origin for browser CORS |
| `YSK_HSTS=1` | Send HSTS on JSON responses |
| `YSK_TRUST_PROXY=1` | Trust XFF (S1) for rate limits |
| `YSK_LLM_ALLOW_PRIVATE=1` | Allow private LLM base URLs |

## Residual

- Full install asset SHA256 pin (I-07)
- Drop query-string share password in a future major
