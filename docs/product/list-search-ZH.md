# 列表搜尋／篩選（C1）

> 語言：中文 | [English](./list-search.md)

**規則：** 功能表格使用**伺服器端**列表搜尋 — `GET …?q=&filter=` + `meta`，而非對整包資料做 client-only `useMemo`。

## 構建塊

| 部件 | 路徑 |
|------|------|
| 查詢契約 | `@yanshekki/shared` `parseListQuery`／`buildListQueryString`／`ListMeta` |
| 伺服器篩選 | `@yanshekki/core` `applyListQuery` · `listWithQuery`（HTTP） |
| Web hook | `useServerList` · resource `useResourceCrud`（debounced `q`） |
| UI | `ListToolbar` · `ServerListFilters` |

## 已覆蓋介面（C1）

| 介面 | 後端 | UI |
|------|------|-----|
| 用戶／方案 | ✅ | ListToolbar |
| 專案 | ✅ | ListToolbar |
| 郵件域名 | ✅ | ListToolbar |
| 更新庫存 | ✅ | ListToolbar |
| Resource CRUD（FTP、DNS、nginx、MySQL、Postgres…） | ✅ `?q=` | ServerListFilters |
| Fleet agents | ✅ | ServerListFilters + 狀態 chips |
| SSL 憑證 | ✅ | ServerListFilters |
| CDN 節點／站點 | ✅ | ServerListFilters |
| 檔案瀏覽器 | ✅ `q` | debounced 搜尋輸入 |
| Cron／審計／managed-nginx／resources（API） | ✅ | CLI／部分 UI |

## 後續潤飾（不阻擋 C1）

- 防護／防火牆／Fail2ban 事件表（主機快照 — 優先工具列 + 伺服器篩選快照）
- 服務矩陣（小矩陣可用 client chips；伺服器可選後加）
- 安全工作階段／API 金鑰列表（自助；量低）

## Agent／CLI

```bash
ysk-server users list --q admin
ysk-server packages list --q starter
ysk-server projects list   # JSON；經 API 代理列表時可擴 --q
```

Resource API 已在 `GET /api/v1/resources/{collection}` 接受 `?q=`。
