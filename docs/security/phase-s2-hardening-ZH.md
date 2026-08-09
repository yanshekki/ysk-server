# 安全硬化 — Phase S2（公開面 + SSRF + 標頭）

語言：中文 | [English](./phase-s2-hardening.md)

S2-1 … S2-7 已修；install checksum 仍為殘項（I-07）。

## 營運 env

- `YSK_CORS_ORIGIN` — 跨源 panel（預設不設 `*`）
- `YSK_HSTS=1` — HTTPS HSTS
- `YSK_TRUST_PROXY=1` — 信任反向代理 XFF
- `YSK_LLM_ALLOW_PRIVATE=1` — 允許私網 LLM
