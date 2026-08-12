# Code Review — 2026-07-30（PR1–PR6 堆疊結案）

## 本輪完成（PR1）

| 項 | 狀態 |
|----|------|
| `ysk-server-shared` `ApplyStatus` + `OpsResultDto` + `assertHonestOps` | **done** (`ops.ts` + tests) |
| Core `OpsApplyResult extends OpsResultDto` | **done** |
| Core `normalizeOpsHonesty` → 轉發 shared | **done** |
| managed-resources `ApplyStatus` 對齊 shared | **done** |
| Web `OpsResultLike` 基於 `OpsResultDto` | **done** |
| `sendOpsResult` 經 `assertHonestOps` | **done** |
| 空殼 `core/{dto,types,interfaces,entities}` 刪除 | **done** |
| `docs/architecture/overview.md` 與 repo 一致 | **done** |
| `docs/frontend-ui.md` 統一規則 + CSS freeze | **done** |

## PR2 誠實 API 全覆蓋（本輪）

| 項 | 狀態 |
|----|------|
| `assertHonestOps` 修正：`requiresExecute` 不打掉 written 成功 | **done** |
| `sendOpsResult` + `statusFromOpsResult` + notFound | **done** |
| controllers / http-server 大量 `ok?200:422` → `sendOpsResult` | **done** (~143 呼叫) |
| `honesty-lint.mjs` + `pnpm honesty:lint` | **done** |
| server honesty unit tests | **done** |

## PR3 去重 + DataTable 統一（本輪）

| 項 | 狀態 |
|----|------|
| Protection 封禁列表 → DataTable；白名單指向 fail2ban 真相 | **done** |
| ResourceTable 頁面改用 DataTable（DNS/FTP/SSL/Nginx/SQL/PG） | **done** |
| ResourceTable 僅作 deprecated thin adapter | **done** |
| ExecutionResultPanel → OpsResultPanel 適配；SslPage 直用 OpsResultPanel | **done** |

## PR4 confirm/btn 統一（本輪）

| 項 | 狀態 |
|----|------|
| 新增 `PromptDialog`（取代 window.prompt） | **done** |
| window.confirm / confirm → ConfirmDialog（全站業務頁） | **done** |
| Link/raw `className="btn …"` → `buttonClassName` / Button | **done**（page 級 0 殘留） |
| TOTP / EMERGENCY / OVERWRITE / SHARED 用 PromptDialog | **done** |

## PR5 CSS 收斂 + Metrics DataTable（本輪）

| 項目 | 狀態 |
|------|------|
| Metrics storage / projects → DataTable | **done** |
| Metrics live process 表 → DataTable（`data-table--live` + `rowClassName`） | **done** |
| 移除 page-primitives-check 對 MetricsPage SKIP | **done** |
| DataTable 支援 `rowClassName` + ReactNode header | **done** |
| CSS：`.data-table--live` 密度/sticky；砍 dead `.met-table*` | **done** |
| `.def-*` / `.fm-*` 與 shared card/token 對齊（既有） | **done**（持續禁新前綴） |

## PR6 CI 硬閘 + 結案（本輪）

| 項目 | 狀態 |
|------|------|
| root `pnpm gates` = honesty:lint + primitives:check + chrome:check | **done** |
| GitHub Actions：gates → typecheck → build → test → e2e | **done** |
| `prepare-release.sh` 跑 gates + typecheck | **done** |
| 文件：CI 門檻寫入 architecture / frontend-ui | **done** |
| `css:reuse` | **hard in gates (Wave2 R6)** — modular CSS + allowed CSS-var inlines only |

## 審查門檻（持續 · 由 CI 硬閘部分強制）

| 門檻 | 強制方式 |
|------|----------|
| H1 禁止 ok&&blocked | `assertHonestOps` + `honesty-lint` + unit tests |
| H2 真實數據 | 產品/審查；e2e:real-ops 部分覆蓋 |
| H3 單業務單入口 | 審查 + 產品地圖 |
| H4 DTO 只在 shared | 架構規則 + 空殼刪除 |
| H5 UI kit only | `primitives:check` + `chrome:check` |
| H6 無重複 link 廢話 | 審查 |
| H7 CSS 不平行開支 | CSS freeze 文件；`pnpm css:reuse` in gates (R6) |

**本地 / CI 一鍵：**

```bash
pnpm gates          # honesty + primitives + chrome
pnpm typecheck
pnpm test
```

