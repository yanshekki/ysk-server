# 面板 ↔ CLI 對齊

> 語系：中文 | [English](./parity.md)

**狀態：C5（2026-08-12）。** 已做到 **db／redis**。剩餘：ftp／files-shares／email／dns／runtime（C6–C7）。

**硬規則：** 面板每一項生產能力都必須有 CLI 入口（或明確標為 ⚠️ 僅面板 UX）。

完整缺口表：[panel-parity-matrix.md](./panel-parity-matrix.md)  
機器盤點：[parity-inventory.json](./parity-inventory.json)（`node scripts/cli-panel-parity.mjs` 或 `pnpm cli:parity`）

## 高優先

| 面板 | 需要 CLI | 狀態 |
|------|----------|------|
| VPN | `vpn …` | ✅ C2 |
| VNC | `vnc …` | ✅ C2（畫布 ⚠️） |
| Apache | `apache sites\|settings …` | ✅ C3 |
| 服務網絡暴露 | `network exposure …` | ✅ C3 |
| Real-IP / Panel TLS | `real-ip …` / `ssl panel-tls …` | ✅ C3 |
| SQL 引擎切換 | `db sql-engine …` | ❌ |
| Redis 鍵瀏覽 | `redis …` | ❌ |

## 故意 ⚠️（僅面板）

瀏覽器終端畫面、in-panel VNC 畫布（CLI 有 `session mint`／`share`／connection 元資料）、Host Browse 畫面、檔案預覽編輯器、公開 share landing。

*最後更新：2026-08-12 — C5（~80%）。*
