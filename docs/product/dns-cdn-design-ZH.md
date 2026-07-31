# DNS／CDN 設計

> 語言：中文 | [English](./dns-cdn-design.md)

> **產品定位：** 用多台 YSK Server + 權威 DNS + Nginx 組成**自建邊緣網**（self-hosted CDN）。  
> **不是** 商業 Anycast/L3 CDN（Cloudflare/Fastly 級全域層）。  
> **誠實契約：** DNS written ≠ 公網生效；單 edge applied ≠ 全網 applied。

---

## 1. 目標與成功標準

### 1.1 使用者故事

1. 我有 2–N 台已裝 ysk-server 的機器（不同 IDC／地區）。
2. 我在其中一台當 **控制平面**，把其他機登錄為 **edge / origin / dns** 節點。
3. 我建立一個 **CDN site**（域名 + origin + 選 edge），系統：
   - 在各 edge 寫入 Nginx reverse proxy + `proxy_cache`
   - 在 DNS 寫入 multi-A（或 failover）指向健康 edge
4. 客戶端解析到多個 edge IP；關一台 edge 後健康檢查摘除其 A 記錄；purge 可對所有 edge 生效。

### 1.2 MVP 成功標準（PR-C4 完成時）

| 條件 | 驗證 |
|------|------|
| 兩 edge + 一 origin | 控制面列表三節點 online |
| 域名 multi-A | dig A 看到兩個 edge 公網 IP |
| 關一 edge | 健康失敗後 dig 只剩存活 IP（min健康y邊緣s 保護） |
| purge | 兩邊 edge 快取皆清 |
| SSL | 至少一種（LE 或上傳）在 edge 生效 |

### 1.3 非目標（明確不做／後期）

| 項目 | 說明 |
|------|------|
| Anycast / BGP | 需要 AS、廠商或特殊網路；不在 YSK 範圍 |
| 全球 PoP 市場 | 使用者自備機器 |
| 完整 WAF SaaS | 可用既有 protection/fail2ban，非 CDN 核心 |
| 影片專用 HLS 切片廠 | 靜態／反向代理快取即可 |
| 自動購買 VPS | 只管理已有節點 |

---

## 2. 角色與架構

```
                    ┌─────────────────┐
   管理 UI/API  ───▶│  Control plane  │  (ysk-server A)
                    │  CDN planner    │
                    │  DNS planner    │
                    └────────┬────────┘
           fleet/SSH fan-out │ DNS apply
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   ┌─────────┐         ┌─────────┐          ┌─────────┐
   │  Edge   │         │  Edge   │          │  DNS    │
   │ Nginx   │         │ Nginx   │          │ BIND/   │
   │ cache   │         │ cache   │          │ PowerDNS│
   └────┬────┘         └────┬────┘          └─────────┘
        │ origin-pull       │
        └─────────┬─────────┘
                  ▼
            ┌──────────┐
            │  Origin  │  (project / 外部 URL)
            └──────────┘
```

| 角色 | 職責 | 可共置 |
|------|------|--------|
| **control** | 編輯政策、規劃、派發、健康彙總 | 常與 origin 同機 |
| **origin** | 跑 app / 靜態源站 | 可與 control 同機 |
| **edge** | Nginx 反代 + proxy_cache；可無 app runtime | 建議獨立 |
| **dns** | 權威解析；執行 multi-A 策略 | 可獨立或同 control |

節點可同時多角色（例如 `['control','origin','dns']`）。

---

## 3. 流量與 DNS 策略

### 3.1 流量模式

| 模式 | 說明 | 優先級 |
|------|------|--------|
| **Direct** | 單 origin，無 CDN（今日預設） | 已有 |
| **源站-pull** | 邊緣 miss 時回源拉內容並快取 | MVP |
| **Reverse-proxy** | 動態站短 TTL；bypass cookie/auth | MVP |
| **Static-edge** | 靜態檔預置／同步到 edge（可後期 rsync） | P2 |
| **External DNS** | CF 管解析，YSK 只管 nginx 機群 | P1 |

### 3.2 DNS 選路策略

| 策略 | 行為 | 優先級 |
|------|------|--------|
| **single** | 單一 edge IP | MVP |
| **multi_a** | 多 A/AAAA 同時發佈 | MVP |
| **failover** | 只發佈健康 edge；不健康摘除 | MVP |
| **weighted** | 依 weight 重複／比例 A | P1 |
| **geo** | region → edge 集合（EDNS Client Subnet 非必須；可用分區 zone 或預設 geo 表） | P2 |

### 3.3 TTL 策略

- `ttl健康y`：健康時（建議 30–120s，CDN 宜短）
- `ttlUnhealthy`：摘除過渡（可更短）
- **min健康y邊緣s**：若健康數 < 門檻，**不摘除**（防全滅），改標 partial + alert

---

## 4. DNS 深化功能清單（PR-D*）

| ID | 功能 | 說明 | 狀態目標 |
|----|------|------|----------|
| D1.1 | Zone 模板 **cdn** | apex + www + cdn 主機 + `_ysk-cdn` TXT 標記 | PR-D1 |
| D1.2 | SOA / TTL / NS 編輯 | 建立時與選中 zone 可改 | PR-D1（既有強化） |
| D1.3 | 記錄驗證 | A/AAAA/MX/CNAME 衝突；儲存前擋 error | PR-D1 |
| D1.4 | dig/lookup API + UI | `/api/v1/dns/lookup`；Tools 分頁 | PR-D1 |
| D1.5 | 驗證 API | `/api/v1/dns/validate` | PR-D1 |
| D2.1 | DNS cluster remote reload | peer SCP 後真實 reload 狀態 | **PR-D2 done** |
| D2.2 | peer 健康 | named/pdns 探活 + lastProbe | **PR-D2 done** |
| D3 | DNSSEC | 金鑰／簽署；DS 給 registrar（不自動上） | 既有 C6 強化 |
| D4 | PowerDNS 完整路徑 | 與 BIND 對稱 apply | 既有 |
| D5 | Cloudflare apply | 外部 DNS；CDN 可選 external | 既有 |
| D6 | `managedBy=user\|cdn` | CDN planner 只覆寫自己的 RRset | PR-C3 |
| D7 | Zone validation (named-checkzone) | apply 前 | Better |
| D8 | 外部 DNS checklist | 給 CF 用戶的「應加入記錄」 | C8 |

---

## 5. CDN 功能清單（PR-C*）

### 5.1 節點（PR-C1）

| 功能 | 說明 |
|------|------|
| 節點 CRUD | name、region、roles、publicIpv4/v6、weight |
| 連線方式 | fleet agent **或** SSH identity（與 migrate/db-cluster 同模型） |
| 心跳 / 探活 | lastHeartbeat、healthUrl（HTTP GET） |
| 狀態 | online / offline / draining / unknown |
| Drain | 停止接收新 DNS 流量；既有連線自然結束 |

### 5.2 站點（PR-C2）

| 功能 | 說明 |
|------|------|
| 站點 CRUD | name、domains[]、mode、origin |
| 源站 | `project`（本機 projectId）或 `url`（外部 upstream） |
| 邊緣 選擇 | edge節點Ids[] |
| DNS 綁定 | zoneId + strategy + TTL 參數 |
| 快取 政策 | enabled、zoneSize、maxAge、bypassCookies、bypassAuth |
| SSL | off / le_http01 / le_dns01 / upload |
| apply_status | overall + 每 edge 的 edge_status |

### 5.3 Nginx edge 設定（PR-C2/C3）

| 功能 | 說明 |
|------|------|
| reverse proxy | `proxy_pass` origin；正確 Host/X-Forwarded-* |
| proxy_cache | 獨立 cache path per site；keys_zone |
| bypass | Set-Cookie、Authorization、nocache 參數 |
| 靜態副檔名 | 長 max-age 可選 |
| purge | 本機 `proxy_cache_purge` 或刪 cache 檔 + 廣播各 edge |
| nginx -t + reload | 每 edge 誠實回傳 |
| 限速 / 連線 | 可選 limit_req（對齊 protection） |

### 5.4 派發 fan-out（PR-C3）

| 功能 | 說明 |
|------|------|
| 並行 apply | 對所有 edge 派發 config |
| 部分失敗 | overall=`partial`；列出失敗 edge |
| 重試單 edge | 不重跑全站 |
| 配置版本 | content hash；避免無謂 reload |

### 5.5 DNS ↔ CDN 聯動（PR-C4 MVP）

| 功能 | 說明 |
|------|------|
| multi_a / failover planner | 依健康 edge 組 A/AAAA |
| managedBy=cdn | 使用者手動記錄不被覆蓋 |
| 健康迴圈 | 週期探活 → 重算 DNS → apply zone |
| dig 驗證 | Tools 分頁對照 |

### 5.6 進階（PR-C5+）

| 功能 | 優先級 |
|------|--------|
| Weighted DNS | P1 |
| Geo map（region → edges） | P2 |
| SSL 憑證分發到 edge | P1 |
| LE HTTP-01 在 edge 完成 | P1 |
| 快取命中率／流量儀表 | P1 |
| 源站 shield（指定一 edge 回源） | P2 |
| 預熱（warm URL list） | P2 |
| 日誌匯總（edge access → control） | P2 |
| 與 project 一鍵「啟用 CDN」 | P1 |
| Cloudflare 作 DNS、YSK 作 edge | P1 |

---

## 6. 資料模型（控制面）

見 `packages/shared/src/cdn.ts`：

- **Cdn節點Dto** — 節點
- **Cdn站點Dto** — 站點政策 + apply_status / edge_status

擴充 DNS 記錄（實作時）：

```ts
// dns_records 額外欄位
managedBy: 'user' | 'cdn'
cdnSiteId?: string
```

持久化建議：`dataDir/cdn/nodes.json`、`dataDir/cdn/sites.json`（與現有 json store 一致）；大型後可遷 SQLite。

---

## 7. API 草圖

### DNS（PR-D1 已定）

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/v1/dns/lookup` | dig/node-dns 查詢 |
| POST | `/api/v1/dns/validate` | 記錄集驗證 |

### CDN（後續）

| Method | Path | 說明 |
|--------|------|------|
| GET/POST | `/api/v1/cdn/nodes` | 節點列表／建立 |
| PATCH/DELETE | `/api/v1/cdn/nodes/:id` | 更新／刪除 |
| POST | `/api/v1/cdn/nodes/:id/probe` | 立即健康檢查 |
| GET/POST | `/api/v1/cdn/sites` | 站點 |
| POST | `/api/v1/cdn/sites/:id/apply` | 派發 edge + DNS |
| POST | `/api/v1/cdn/sites/:id/purge` | 全 edge 清快取 |
| POST | `/api/v1/cdn/sites/:id/dns-sync` | 僅重算 DNS |
| GET | `/api/v1/cdn/sites/:id/status` | 彙總健康／apply |

所有寫入回傳 **OpsResultDto** 風格：`ok` / `partial` / notes / per-target status。

---

## 8. Nginx 配置要點（edge）

```nginx
# 概念片段 — 實作由 renderer 產生
proxy_cache_path /var/cache/ysk-cdn/<siteId>
  levels=1:2 keys_zone=ysk_<siteId>:10m max_size=1g inactive=60m;

server {
  listen 443 ssl http2;
  server_name example.com www.example.com;

  location / {
    proxy_pass https://origin.example.internal;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache ysk_<siteId>;
    proxy_cache_valid 200 10m;
    proxy_cache_bypass $http_pragma $cookie_session $http_authorization;
    add_header X-YSK-Cache $upstream_cache_status;
  }
}
```

- 每 site 獨立 keys_zone / path
- 動態模式：縮短 valid、強制 bypass cookie
- purge：`PURGE` method 或 control 端 SSH 刪目錄

---

## 9. 誠實與安全

| 原則 | 實作 |
|------|------|
| 不裝 Anycast | UI/文件明確「DNS 級分流」 |
| partial 不裝 applied | 任一 edge 失敗 → overall partial |
| DNS ≠ 即時 | notes 寫「TTL 內仍可能打到舊 IP」 |
| min健康y邊緣s | 預設 ≥ 1；全滅不摘 |
| 權限 | CDN apply 需 EXECUTE + 適當角色 |
| 密鑰 | SSH identity 不落 UI；edge 僅收 config |
| 租戶 | multi-tenant 時 site 綁 account（後期） |

---

## 10. UI 資訊架構

| 頁面 | 內容 |
|------|------|
| `/dns` | 既有 zones/records/cluster/dnssec + **工具（dig）** + CDN 模板 |
| `/cdn`（新） | 節點 · 站點 · 套用狀態 · purge · 健康 |
| Project 詳情 | 「啟用 CDN」深鏈 → 預填 origin=project |
| `/nginx` | 可顯示 CDN 管理的 vhost（唯讀標記 managedBy=cdn） |

CDN 頁建議分頁：**節點** | **站點** | **健康** | **工具（purge / dig）**

---

## 11. 實作順序（PR 計劃）

| PR | 範圍 | 依賴 |
|----|------|------|
| **PR-D1** | CDN zone 模板、validate、lookup、Tools UI、shared cdn types、本設計文 | — |
| **PR-D2** | DNS cluster remote reload + peer 狀態誠實化 | D1 |
| **PR-C1** | cdn_nodes CRUD + probe + UI 骨架 (**done**) | shared types |
| **PR-C2** | cdn_sites + Nginx renderer（單 edge dry-run）(**done**) | C1 |
| **PR-C3** | fleet/SSH fan-out 多 edge apply + purge (**done**) | C2, migrate/db-cluster 模式 |
| **PR-C4** | DNS multi-A/failover + managedBy + 健康迴圈 **MVP** (**done**) | C3, D1 |
| **PR-C5** | Weighted + 儀表（命中率粗估）(**done**) | C4 |
| **PR-C6** | SSL 分發 / LE on edge (**done**) | C4 |
| **PR-C7** | Geo + origin shield + project 一鍵 (**done**) | C5 |

---

## 12. 與現有模組對齊

| 既有 | 復用 |
|------|------|
| host-migrate / db-cluster fleet | SSH + agent 派發模式 |
| dns-zone / cloudflare-dns | zone 寫入、外部 DNS |
| nginx apply | -t + reload 誠實結果 |
| SoftwareInstallBanner | edge 需 nginx；dns 需 bind/pdns |
| OpsResultDto | 全 CDN apply 回傳 |
| protection / fail2ban | edge 可選套用 |

---

## 13. 驗收檢查表（MVP）

- [x] 建立 2 edge 節點並 probe online（PR-C1）  
- [x] 建立 site，origin=url（PR-C2）  
- [x] apply → edge nginx conf fan-out（PR-C3）  
- [x] DNS multi-A 寫入 managedBy=cdn（PR-C4）  
- [x] failover / min健康y邊緣s 防全滅（PR-C4）  
- [x] purge 兩邊 cache（PR-C3）  
- [x] 手動 user 記錄不被 CDN planner 覆蓋（PR-C4）  

實機 dig 驗證仍取決於 zone apply + 公網 NS；控制面可於 `/dns` 工具分頁對照。

---

*最後更新：PR-C4 MVP done（multi-A / failover + health loop）。*
