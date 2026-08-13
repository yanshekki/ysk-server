# 防護中心（Defense Center）— 100% 範圍

> Language: English | [中文](./defense-ZH.md)

路由：`/protection` · API：`/api/v1/defense/*`

側欄安全區：**防護中心** + **帳號安全**（單一入口）。  
UFW `/protection/firewall` · fail2ban `/protection/fail2ban` 由「底層」進入（子工具，非側欄一級）。  
舊路徑 `/firewall`、`/fail2ban` **redirect** 到上述子路由（保留 query）。

## 產品完成度

| 能力 | 狀態 |
|------|------|
| 威脅儀表 + 四檔防護 | ✅ |
| Nginx limit 注入 vhost | ✅ |
| 可疑 IP / 批量 ban / 白名單 | ✅ |
| 自動化升檔 + hold + 回落 | ✅ |
| 自動 ban 閾值／自訂／熔斷 | ✅ |
| 掃描間隔跟面板（scheduler dynamic） | ✅ |
| 訊號權重可調 | ✅ |
| 情報 Top IP + auth 失敗 | ✅ |
| Vhost 限速標記一覽 | ✅ |
| Cloudflare Under Attack API | ✅（需 `CF_API_TOKEN`） |
| 緊急檔永不自動 | ✅ |
| written ≠ applied | ✅ |

## 一鍵防護檔

| 檔 | Nginx | fail2ban | 確認 |
|----|-------|----------|------|
| 日常 | ~20r/s | 標準 jails | — |
| 加固 | ~8r/s | 更多 jails | — |
| 受攻擊 | ~3r/s | 含 limit-req | 確認；可觸發 CF UA |
| 緊急 | ~1r/s | 最小集 | `EMERGENCY` |

## 自動化

- `GET/PUT /api/v1/defense/automation`
- `POST /api/v1/defense/auto-ban/tick` — 完整一輪
- `GET /api/v1/defense/intel` — Top IP + vhost markers
- `POST /api/v1/defense/cloudflare/under-attack` — `{ enable, zones }`
- Scheduler job `defense-auto-ban`：`everyDynamic`，間隔 = `autoBan.intervalSeconds`（30–600s）

### 機制

探測（權重可調）→ 評分 → 可自動切防護檔 → 可自動 ban → 可選 CF Under Attack。  
**緊急檔永不自動**；無 `YSK_EXECUTE` 只 written／記面板。

## 已補齊（最後三件）

| 項 | 狀態 |
|----|------|
| 威脅級顯示 = 自動升檔門檻 | ✅ `threatThresholdsFromAutoPreset` |
| 受攻擊時 UFW 只放 CF 網段 | ✅ `cloudflare.ufwAllowOnlyCf` → `firewall/ufw-cf-only.sh` |
| 自動化 tick 整合測試 | ✅ `automation.test.ts` mock host |

## 其餘（延伸／誠實）

| 項 | 說明 |
|----|------|
| fail2ban per-jail 參數 | 全站有；每 jail 獨立屬延伸 |
| 無 EXECUTE | 只 written／記面板 — 設計如此 |
| L3/L4／多 CDN／fleet | 範圍外 |

## C2 深化（2026-07-31）

| 能力 | API / CLI |
|------|-----------|
| Bans list + `?q=` + `source=` facets | `GET /api/v1/defense/bans` · `ysk-server defense bans --q` |
| Suspects / timeline list query | `GET …/suspects?q=` · `GET …/timeline?q=` |
| **One-shot stack apply** | `POST /api/v1/defense/stack/apply` · `ysk-server defense stack-apply [--execute]` |
| Firewall rules filter | `GET /api/v1/system/firewall/status?q=` |
| Protection UI | bans ServerListFilters + source chips + stack apply 掣 |

Stack apply = UFW plan + fail2ban jails（當前 preset）+ re-apply defense preset。無 EXECUTE 時 honest blocked。

## 誠實邊界

- L3/L4 純頻寬洪水需上游／CDN scrubbing（面板提供 CF UA，不替代 scrub）  
- 多 CDN 商、fleet 聯防屬範圍外延伸（本版以單機 + CF 為 100% 內範圍）  

## 環境

```bash
YSK_EXECUTE=1          # 真套用系統
CF_API_TOKEN=...       # Cloudflare API
YSK_AUTO_BAN_INTERVAL_MS=120000  # 僅 fallback；優先用面板間隔
```

## IP 准入（國家 / 地區 / ASN）

- **庫：** 本地 MMDB，每日自動更新（`defense-geoip-update`）
- **預設來源：** [sapics/ip-location-db](https://github.com/sapics/ip-location-db) `user-country` + `origin-asn`（PDDL，免 API key）
- **可選：** `IPINFO_TOKEN` → IPinfo Lite（國家 + 大陸 + ASN 一檔，CC BY-SA）
- **地區 Phase1：** 大陸（continent），不是省市
- **供應商：** ASN（如 AS13335），不保證等於消費品牌名
- **執行：** 政策評估 + nginx 片段（需 geoip2 模組）；**不會**把整國 CIDR bulk 寫入 UFW
- **API：** `GET/POST /api/v1/defense/geoip/*`
- 面板：**防護中心 → IP 准入** tab
