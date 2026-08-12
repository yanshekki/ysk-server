# 面板 ↔ CLI 對齊

> 語系：中文 | [English](./parity.md)

**狀態：已重開（2026-08-12）。** 2026-08-09 的 Phase 4「已封板」**作廢**。其後面板新增 VPN／VNC／Apache／服務埠暴露等，CLI 未跟上。

**硬規則：** 面板每一項生產能力都必須有 CLI 入口（或明確標為 ⚠️ 僅面板 UX）。

完整缺口表：[panel-parity-matrix.md](./panel-parity-matrix.md)  
機器盤點：[parity-inventory.json](./parity-inventory.json)（`node scripts/cli-panel-parity.mjs` 或 `pnpm cli:parity`）

## 高優先 ❌

| 面板 | 需要 CLI |
|------|----------|
| VPN | `vpn …` |
| VNC | `vnc …` |
| Apache | `apache …` |
| 服務網絡暴露 | `network exposure …` |
| SQL 引擎切換 | `db sql-engine …` |
| Redis 鍵瀏覽 | `redis …` |

## 故意 ⚠️（僅面板）

瀏覽器終端畫面、noVNC 視窗、Host Browse 畫面、檔案預覽編輯器、公開 share landing。

*最後更新：2026-08-12 — C0。*
