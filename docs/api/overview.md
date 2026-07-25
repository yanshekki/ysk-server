# YSK Server API Overview

Base URL: `http://127.0.0.1:8787`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Health / protection mode JSON |
| GET | `/api/v1/health` | No | Same as `/health` |
| GET | `/api/v1/status` | No | Product, version, tool list |
| POST | `/api/v1/auth/login` | No | `{ username, password }` → token |
| GET | `/api/v1/auth/me` | Bearer | Current user |
| POST | `/api/v1/agents/register` | No* | Register outbound agent session |
| POST | `/api/v1/tools/execute` | Bearer | Allowlist-gated tool call |
| GET | `/api/v1/approvals` | Bearer | List approval queue |
| POST | `/api/v1/approvals/:id/approve` | Bearer | Approve pending action |
| POST | `/api/v1/rbac/check` | No | Evaluate RBAC decision |
| POST | `/api/v1/protection` | No | Update protection mode signals |

\* Agent registration should be hardened with enrollment tokens in production.

## Health response example

```json
{
  "status": "ok",
  "product": "YSK Server",
  "version": "0.1.0",
  "protectionMode": "normal",
  "timestamp": "2026-07-25T00:00:00.000Z"
}
```

## Tool execute

High-risk tools return `requiresApproval: true` and an `approvalId` until a human approves.
