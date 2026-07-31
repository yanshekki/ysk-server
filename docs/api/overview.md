# HTTP API overview

> Language: English | [中文](./overview-ZH.md)

Base: `/api/v1/…` on the `serve` listener. Auth: `Authorization: Bearer <session-or-ysk-key>`.

Locale: `Accept-Language` or `?locale=`.

Major groups: `/auth`, `/projects`, `/email`, `/files`, `/backups`, `/cron`, `/defense`, `/cdn`, `/agents`, `/readiness`, …

Ops mutations return honest `OpsResultDto` bodies. Prefer CLI for agents.

Full OpenAPI is not published; use panel network tab + route modules under `apps/server/src/routes/`.
