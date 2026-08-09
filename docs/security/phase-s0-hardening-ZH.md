# 安全硬化 — Phase S0（緊急閘門）

語言：中文 | [English](./phase-s0-hardening.md)

範圍：HostExecutor fail-closed、路徑沙箱、Tools 檔案、Fleet 認證、API Key 範圍、啟動密碼。

詳見英文版 finding 表（S0-1 … S0-8 均已 **Fixed**）。

## 營運注意

- Edge agent 必須保存 register 回傳的一次性 `token`（`ysk_agent_…`），heartbeat / pull / ack 帶 `X-Ysk-Agent-Token`。
- 未登入 register 需 `YSK_FLEET_ENROLL_TOKEN` 或設定 `fleet.enroll_token`。
- 互聯網主機禁止 `YSK_ALLOW_INSECURE_DEFAULTS=1`。

## 後續

- S1：SQL 注入、cron、跨專案檔案、session 哈希
- S2：CORS、status 洩漏、SSRF、install checksum
