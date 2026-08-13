# 前端 UI

> 語言：中文 | [English](./frontend-ui.md)

## 技術棧

- 應用：`apps/web`（React + TypeScript）
- 佈局：FSD-lite 頁面 + shared UI 套件
- i18n：`ysk-server-shared` 語言包（預設 zh-HK）

## 原則

1. 操作員可見字串只用 `t()`。  
2. 每功能單一主入口（見 feature-single-entry）。  
3. 操作結果誠實顯示 blocked／dry-run。  
4. 列表頁使用共用 list-query／工具列模式。  
5. 執行期不連外 CDN：JS、CSS、字型均打入面板 build（系統字型）。  
6. 列表用共用 `DataTable`：桌面為真表格；≤720px 為分卡 + ⋯ 操作選單。  
7. 手機頂欄只留選單與搜尋。語言、帳號、登出放在抽屜**最下方**。  
8. 操作結果用**右上角 toast**（`toast.ok`／`toast.error`）。即時串流與長作業用**右下角 Dock**（可縮小）。不要把安裝日誌或一次性套用錯誤嵌在頁面中間。  

## 主要路由

見 [product-page-map-ZH.md](./product-page-map-ZH.md)。

## 相關

[i18n-ZH.md](./i18n-ZH.md) · [architecture/overview-ZH.md](./architecture/overview-ZH.md)
