# 安全覆核 — Phase 7（2026-08-09）

語言：中文 | [English](./phase-7-review.md)

範圍：Tier-2 i18n、CLI 對齊、說明 tab UX 之後，對公開分享／WebDAV 等表面再驗一次。

## 發現

| ID | 嚴重度 | 範圍 | 狀態 |
|----|--------|------|------|
| P7-1 | 中 | 分享密碼以無鹽 SHA-256 儲存 | **已修** — 新建為 `scrypt$salt$hash`；舊 SHA-256 仍可驗證 |
| P7-2 | 中 | 公開分享密碼可無限猜 | **已修** — `share-auth` 限流（15 分鐘內 10 次失敗 → 鎖 15 分鐘）按 IP+token |
| P7-3 | 中 | WebDAV Basic 失敗無限 | **已修** — `webdav-auth` 按 IP 限流 |
| P7-4 | 低 | `pathAllowed` 空 root／裸 `/` 邊界 | **已修** — 忽略空 root；`/` 只允許精確 `/` |
| P7-5 | 低 | 頁面 chrome 閘門未涵蓋訪客／re-export | **已修** — SKIP 列表 + SoftwareHub `status=` |
| P7-6 | 資訊 | WebDAV token 仍為高熵密文 SHA-256 | 接受 — 24-byte 隨機 token，非用戶自選密碼 |
| P7-7 | 資訊 | 公開下載 CORS `*` | 維持有意設計（訪客客戶端） |

## 後續

- 可選：為 share／WebDAV 的 401／429 加 fail2ban jail（營運文件）。
- 舊分享在下次設密碼時自動升級為 scrypt（新建已是 scrypt）。
- WebDAV 用量增大時再加 PROPFIND depth／列表上限。

## 驗證

- 安全相關定向套件（必須全綠）：
  ```bash
  pnpm --filter @ysk/core exec vitest run \
    src/files/manager.test.ts \
    src/files/manager.depth.test.ts \
    src/files/webdav.test.ts \
    src/files/shares.test.ts \
    src/security/sandbox.test.ts
  ```
- `pnpm chrome:check`／i18n 閘門（11 語言 key 對齊）
- shared：`normalizeLocale` Tier-2 + RTL 單測
- 完整 `@ysk/core` 套件可能含無關環境 flaky；Phase 7 驗收以以上安全檔案集為準。

## 相關

[phase-0-review-ZH.md](./phase-0-review-ZH.md) · [overview-ZH.md](./overview-ZH.md)
