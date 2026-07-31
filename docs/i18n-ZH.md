# 國際化（i18n）

> 語言：中文 | [English](./i18n.md)

## 支援語言

| Code | 說明 |
|------|------|
| **zh-HK** | 預設 · 香港書面語 |
| **zh-CN** | 规范简体 |
| **en** | English |

`zh-TW`／裸 `zh` → 正規化為 `zh-HK`。

## 文案來源

`packages/shared/locales/{zh-HK,zh-CN,en}/` — 唯一真相。  
Web：`t()` · 後端：`tl()` · CLI：`--locale`／`YSK_LOCALE`。

## 閘門

```bash
pnpm i18n:check-keys
pnpm i18n:check-ui
pnpm i18n:check-api
pnpm i18n:check-glossary
pnpm i18n:rebuild
```

詳見英文版 [i18n.md](./i18n.md) 的 L0–L12 狀態表。
