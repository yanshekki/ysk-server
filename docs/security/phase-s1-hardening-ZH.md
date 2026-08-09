# 安全硬化 — Phase S1（注入 + 多租戶）

語言：中文 | [English](./phase-s1-hardening.md)

範圍：SQL 注入、cron 注入、專案檔案權限、session 哈希、代理 IP 信任、chown/symlink 邊界。

S1-1 … S1-10 均已 **Fixed**（見英文版表）。

## 營運

- 反向代理後請設 `YSK_TRUST_PROXY=1`
- 非 admin 瀏覽 `project:` 檔案需 `files.project` 能力
