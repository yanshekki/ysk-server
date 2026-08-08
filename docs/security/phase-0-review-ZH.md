# 安全審查 — Phase 0（2026-08-09）

語言：中文 | [English](./phase-0-review.md)

範圍：控制面檔案沙箱、公開分享、WebDAV Basic、相關密碼雜湊比對。

## 發現

| ID | 嚴重度 | 範圍 | 狀態 |
|----|--------|------|------|
| P0-1 | High | FileManager `assertInside` 用裸 `startsWith(root)` | **已修** — 邊界安全前綴 + 拒絕 null byte |
| P0-2 | High | WebDAV 只要密碼對、用戶名任意都通過 | **已修** — 用戶名必須 `ysk` |
| P0-3 | Medium | WebDAV／分享密碼雜湊非常量時間比對 | **已修** — `timingSafeEqual` / `safeHexEqual` |
| P0-4 | Medium | WebDAV 路徑無提前過濾 `..` 段 | **已修** — FileManager 前拒絕 |
| P0-5 | Medium | 分享密碼為無鹽 SHA-256 | 短期接受；後續改 scrypt/argon2 |
| P0-6 | Low | WebDAV 功能有限；PROPFIND 列表無上限 | 記錄；限速／Depth 後續 |
| P0-7 | Info | 部分公開下載 CORS `*` | 公開分享有意為之；持續監察 |

## 後續

- 分享密碼／WebDAV token 雜湊改 **scrypt/argon2**（Phase 7 複審）。
- 可選：公開分享與 WebDAV 登入失敗限速。
- Terminal／TOTP／API keys 於 Phase 7 再掃。

## 驗證

- `@ysk/core` 檔案管理與 webdav 單元測試已更新並通過。
EOF