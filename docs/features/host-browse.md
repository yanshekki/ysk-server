# Host Browse

> Language: English | [中文](./host-browse-ZH.md)

## Purpose

**Host Browse** lets operators open HTTP(S) URLs **through the control-plane host**:

- Internet (public sites) and Intranet (LAN / RFC1918 admin UIs)
- Egress IP, DNS, and TLS use the **host** — not the operator’s desktop browser
- Target sites never see the operator browser User-Agent, Client Hints, panel cookies, or operator client IP

## Route

| Item | Value |
|------|--------|
| UI | `/browse` |
| API | `/api/v1/host-browse/*` |
| Capability | `network.browse` (privilege; admin factory includes it) |
| `YSK_EXECUTE` | **Not required** (outbound HTTP from the panel process) |

## Tabs

| Tab | Content |
|-----|---------|
| Browse | Browser chrome + Internet/Intranet mode + sandboxed content |
| About | Page guide (security model & limits) |

## Privacy model

- Fixed User-Agent: `YSK-HostBrowse/1.0 …`
- Header allowlist only (no `Authorization`, `Sec-CH-*`, `X-Forwarded-For`, panel `Origin`, …)
- Cookie jar is **server-side** per session
- Content iframe uses a short-lived `contentToken` (not the long-lived API Bearer in logs)

## SSRF

| Mode | Policy |
|------|--------|
| Internet | Block loopback, RFC1918, link-local, ULA, cloud metadata |
| Intranet | Allow private LAN; **always** block cloud metadata; loopback off unless `YSK_HOST_BROWSE_LOOPBACK=1` |

DNS rebinding: resolve A/AAAA and check every address before connect; re-check redirects.

## Limits (v1)

- Not a full Chromium substitute — complex SPAs may break
- No WebSocket upgrade to targets
- Response body cap ~8 MiB; rate limit ~60 navigations / user / minute

## Related

[Network](./system-host.md) · [Terminal](../security/ssh.md) · [product-page-map](../product-page-map.md)
