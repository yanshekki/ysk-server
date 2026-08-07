# 國際化（i18n）

> 語言：中文 | [English](./i18n.md)

## 支援語言

| Code | 說明 |
|------|------|
| **zh-HK** | 預設 UI |
| **zh-CN** | 简体中文 |
| **en** | English |

`zh-TW`／裸 `zh` 正規化為 `zh-HK`。

## 唯一真相來源

```
packages/shared/locales/{zh-HK,zh-CN,en}/
```

Web：`t()`（react-i18next）。後端：`tl()`／`t(locale, key)`。CLI：`--locale`／`YSK_LOCALE`。

## 開發流程

1. 三語 namespace JSON 同步修改。  
2. 優先語義 key；先寫 zh-HK，再 zh-CN 與 en。  
3. `pnpm i18n:rebuild`  
4. `pnpm i18n:check-keys && pnpm i18n:check-glossary && pnpm i18n:check-ui && pnpm i18n:check-api`

## 閘門

| 腳本 | 作用 |
|------|------|
| `i18n:check-keys` | 三語 key 集合一致 |
| `i18n:check-ui` | Web 源碼禁止硬編碼中文 |
| `i18n:check-api` | core／server 禁止硬編碼操作員中文 |
| `i18n:check-glossary` | zh-HK 禁用詞（台／陸用詞 + 粵語口語） |
| `i18n:check-drift` | namespace 與 translation.json 必須一致 |
| `i18n:check-guides` | 說明 tab 三語 id／結構對齊 |

文案原則見 [copy-i18n-standard-ZH.md](./copy-i18n-standard-ZH.md)。

## 請求語言

| 來源 | 優先 |
|------|------|
| HTTP `Accept-Language` | API 訊息主來源 |
| `?locale=` | 覆寫 |
| CLI `--locale`／環境變數 | CLI 工作階段 |

## 相關

[architecture/overview-ZH.md](./architecture/overview-ZH.md) · [frontend-ui-ZH.md](./frontend-ui-ZH.md)
