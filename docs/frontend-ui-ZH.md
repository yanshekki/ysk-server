# 前端 UI

> 語言：中文 | [English](./frontend-ui.md)

## 技術棧

- 應用：`apps/web`（React + TypeScript）
- 佈局：FSD-lite 頁面 + shared UI 套件
- i18n：`@ysk/shared` 語言包（預設 zh-HK）

## 原則

1. 操作員可見字串只用 `t()`。  
2. 每功能單一主入口（見 feature-single-entry）。  
3. 操作結果誠實顯示 blocked／dry-run。  
4. 列表頁使用共用 list-query／工具列模式。  

## 主要路由

見 [product-page-map-ZH.md](./product-page-map-ZH.md)。

## 相關

[i18n-ZH.md](./i18n-ZH.md) · [architecture/overview-ZH.md](./architecture/overview-ZH.md)
