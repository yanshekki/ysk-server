# HTTP API 概覽

> 語言：中文（香港書面語）| [English](./overview.md)

基底：`serve` 監聽上的 `/api/v1/…`。認證：`Authorization: Bearer <session 或 ysk 金鑰>`。

語言：`Accept-Language` 或 `?locale=`。

主要組：`/auth`、`/projects`、`/email`、`/files`、`/backups`、`/cron`、`/defense`、`/cdn`、`/agents`、`/readiness`…

變更回傳誠實 `OpsResultDto`。Agent 優先 CLI。

未發布完整 OpenAPI；可參考面板網絡分頁與 `apps/server/src/routes/`。
