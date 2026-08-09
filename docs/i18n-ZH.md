# 國際化（i18n）

> 語言：中文 | [English](./i18n.md)

## 支援語言

### Tier-1（品質基準 — 完整母語目錄）

| Code | 說明 |
|------|------|
| **zh-HK** | 預設 UI — 香港書面語 |
| **zh-CN** | 简体中文 |
| **en** | English（多語擴展時 key 的 SSOT） |

### Tier-2（全球常用語言 — 以英文 scaffold）

| Code | 說明 | 方向 |
|------|------|------|
| **hi** | 印地語 | LTR |
| **es** | 西班牙語 | LTR |
| **ar** | 阿拉伯語 | **RTL** |
| **fr** | 法語 | LTR |
| **bn** | 孟加拉語 | LTR |
| **pt** | 葡萄牙語 | LTR |
| **id** | 印尼語 | LTR |
| **ur** | 烏爾都語 | **RTL** |

`zh-TW`／裸 `zh` 正規化為 `zh-HK`。舊標籤 `in`（印尼）→ `id`。  
登錄：`packages/shared/locales/locales.json` 與 `packages/shared/src/i18n/normalize-locale.ts`。

## 唯一真相來源

```
packages/shared/locales/{locale}/{namespace}.json
packages/shared/locales/locales.json          ← 語言列表 + RTL + 顯示名稱
```

Web：`t()`（react-i18next，`apps/web/src/shared/lib/i18n.ts`）。  
後端：`tl()`／`t(locale, key)`。CLI：`--locale`／`YSK_LOCALE`。  
RTL：`isRtlLocale()` 為 `ar`、`ur` 設定 `<html dir="rtl" lang="…">`。

說明 tab：Tier-1 有 `apps/web/src/shared/guides/data/{zh-HK,zh-CN,en}.json`；Tier-2 回退英文。

## 開發流程

1. **Tier-1 品質基準：** 同步改 zh-HK／zh-CN／en namespace。  
2. 優先語義 key；先寫 zh-HK，再 zh-CN 與 en。  
3. Tier-2 起始為 `packages/shared/locales/{hi,es,…}/` 的英文副本；之後可只改字串、不改 key。  
4. `pnpm i18n:rebuild`  
5. `pnpm i18n:check-keys && pnpm i18n:check-glossary && pnpm i18n:check-ui && pnpm i18n:check-api && pnpm i18n:check-drift && pnpm i18n:check-guides`

## 閘門

| 腳本 | 作用 |
|------|------|
| `i18n:check-keys` | **所有** locale 目錄 key 集合一致（SSOT = en） |
| `i18n:check-ui` | Web 源碼禁止硬編碼中文 |
| `i18n:check-api` | core／server 禁止硬編碼操作員中文 |
| `i18n:check-glossary` | zh-HK 禁用詞（台／陸用詞 + 粵語口語） |
| `i18n:check-drift` | 每個 locale 的 translation.json 須與 namespace 一致 |
| `i18n:check-guides` | 說明 tab Tier-1（zh-HK／zh-CN／en）id／結構對齊 |

文案原則見 [copy-i18n-standard-ZH.md](./copy-i18n-standard-ZH.md)。

## 請求語言

| 來源 | 優先 |
|------|------|
| HTTP `Accept-Language` | API 訊息主來源 |
| `?locale=` | 覆寫 |
| 使用者資料 `locale` | 登入後 |
| CLI `--locale`／環境變數 | CLI 工作階段 |

## 相關

[architecture/overview-ZH.md](./architecture/overview-ZH.md) · [frontend-ui-ZH.md](./frontend-ui-ZH.md) · [copy-i18n-standard-ZH.md](./copy-i18n-standard-ZH.md)
