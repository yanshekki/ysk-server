# Copy & i18n standard

Operator-facing text rules for YSK Server (Web + API + notes).

## Languages

### Tier-1 (required quality bar)

| Code | Role |
|------|------|
| **zh-HK** | Default UI. **Hong Kong written Chinese** only — no spoken Cantonese. |
| **zh-CN** | Simplified Chinese (standard PRC UI wording). |
| **en** | Concise English. No marketing fluff. Key SSOT for multi-locale expansion. |

Tier-1 must share the same key tree. **Tier-2** (`hi`, `es`, `ar`, `fr`, `bn`, `pt`, `id`, `ur`) ship as English scaffolds with the same keys; native translation may replace values later. `ar` / `ur` are RTL.

## SSOT

```
packages/shared/locales/{locale}/{namespace}.json   ← edit only here
pnpm i18n:rebuild                                   ← required after edits
packages/shared/locales/{locale}/translation.json   ← generated; never hand-edit
apps/web/src/shared/guides/data/{locale}.json       ← About-tab bodies (3 locales)
```

Backend: `tl()` / `t(locale, key)`. Frontend: `t('ns.key')`. Never hardcode user-visible strings.

## No fluff on the main surface

| Allowed on main UI | Only in About tab |
|--------------------|-------------------|
| Button / label / short field hint | What this page is for |
| One-line danger / permission | Background, workflow, limits |
| Empty / error one-liners | “How it works” essays |
| KPI labels | Long blue-banner tutorials |

If it explains **why the feature exists**, move it to **說明 / About**.

## About tab shape

- **title** — page name  
- **summary** — one sentence  
- **canDo** — up to 5 action bullets  
- **notes** — up to 4 caveats  
- **related** — optional links  

## Concision

- Buttons: short verb phrase  
- Hints: one sentence (≈ ≤40 zh chars / ≤12 en words); delete if obvious  
- Errors: reason + optional next step, each one line  

## zh-HK written Chinese

Use: 請、會、已、可、須、勿、軟件、網絡、設定、伺服器、預設、登入、重新整理、磁碟、建立  

Do not use spoken: 唔、嚟、咗、哋、吓、啦、係咪、搞掂、冇  

Do not use TW/CN false friends (see glossary lint): 軟體→軟件、網路→網絡、默認→預設、…

## Workflow

1. Write **zh-HK** namespace keys (written, short).  
2. Mirror **zh-CN** and **en**.  
3. `pnpm i18n:rebuild`  
4. `pnpm i18n:check-keys && pnpm i18n:check-glossary && pnpm i18n:check-ui && pnpm i18n:check-api && pnpm i18n:check-drift && pnpm i18n:check-guides`  

## Related

[i18n-ZH.md](./i18n-ZH.md) · [i18n.md](./i18n.md)
