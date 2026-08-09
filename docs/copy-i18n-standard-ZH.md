# 文案與語言包標準

YSK Server 操作員可見文字的統一規則（Web、API、notes）。

## 語言

### Tier-1（品質基準，缺一不可）

| Code | 角色 |
|------|------|
| **zh-HK** | 預設 UI。**香港書面語**，禁止粵語口語。 |
| **zh-CN** | 规范简体。 |
| **en** | 簡潔英文，無行銷腔。多語擴展時 key 的 SSOT。 |

Tier-1 必須同一 key 樹。**Tier-2**（`hi`、`es`、`ar`、`fr`、`bn`、`pt`、`id`、`ur`）以英文 scaffold 出貨、key 相同；之後可只改譯文。`ar`／`ur` 為 RTL。

## 唯一真相來源

```
packages/shared/locales/{locale}/{namespace}.json   ← 只改這裡
pnpm i18n:rebuild                                   ← 改完必跑
packages/shared/locales/{locale}/translation.json   ← 產物，勿手改
apps/web/src/shared/guides/data/{locale}.json       ← 說明 tab 正文
```

後端：`tl()`。前端：`t()`。禁止硬編碼使用者可見字串。

## 主操作區無廢話

| 主區可留 | 只放說明 tab |
|----------|--------------|
| 按鈕、標籤、一行欄位提示 | 本頁用途 |
| 危險／權限一句 | 背景、流程、邊界 |
| 空狀態／錯誤一句 | 長篇教學 |

解釋「功能有何用」→ **說明 tab**。

## 說明 tab 結構

- **title** — 頁名  
- **summary** — 一句  
- **canDo** — 最多 5 條可做事項  
- **notes** — 最多 4 條注意  
- **related** — 可選相關連結  

## 精簡

- 按鈕：短動詞片語  
- 提示：一句；明顯則刪  
- 錯誤：原因 +（可選）下一步，各一句  

## 香港書面語

宜用：請、會、已、可、須、勿、軟件、網絡、設定、伺服器、預設、登入、重新整理  

禁用口語：唔、嚟、咗、哋、吓、啦、係咪、搞掂、冇  

禁用錯用語（見 glossary）：軟體→軟件、網路→網絡、默認→預設…

## 改文案流程

1. 先寫 **zh-HK**  
2. 同步 **zh-CN**、**en**  
3. `pnpm i18n:rebuild`  
4. 跑齊 `i18n:check-*`  

## 相關

[i18n-ZH.md](./i18n-ZH.md) · [copy-i18n-standard.md](./copy-i18n-standard.md)
