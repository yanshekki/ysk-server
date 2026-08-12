# YSK Server

> 語言：中文 | [English](./README.md)

**YSK Server**（`ysk-server`）是以**安全與誠實**為優先的**單機 Linux 控制平面**，附架站面板與適合 AI 的 CLI。

| 項目 | 說明 |
|------|------|
| CLI | `ysk-server` |
| 預設介面語言 | **zh-HK**，另有 zh-CN、en |
| 規格 | [docs/AI-Secure-Linux-Server-Manager-Spec.md](docs/AI-Secure-Linux-Server-Manager-Spec.md) |
| 文件索引 | [docs/INDEX-ZH.md](docs/INDEX-ZH.md) |

## 是／不是

| 是 | 不是 |
|----|------|
| 你掌管的一部伺服器（VPS／實體機） | 多租戶 Reseller SaaS |
| **root** + **`YSK_EXECUTE=1`** 時可真實改主機 | 未套用卻回報成功 |
| 面板 + HTTP API + CLI（同一 core） | 完整網頁終端機產品 |
| 郵件**可送達性檢查**（誠實） | 保證 Gmail／Outlook 進 inbox |

## 快速上手

### 生產／VPS（套餐／方案嚮導）

`install.sh` 提供**方案**（`recommended`／`full`／`minimal`／自訂套餐）。非互動預設 **recommended**（控制平面 + web + database + defense）。用 `uninstall.sh` 做部份／全部移除（可保留或清除資料）。詳見 [install-ZH.md](docs/getting-started/install-ZH.md) · [uninstall-ZH.md](docs/getting-started/uninstall-ZH.md)。

```bash
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --non-interactive
# 全裝：… | bash -s -- --non-interactive --plan full
# 僅控制平面：… | bash -s -- --non-interactive --plan minimal
# 解除安裝：./uninstall.sh
ysk-server readiness --json
ysk-server serve --data-dir /var/lib/ysk-server --port 9287
```

### monorepo 開發

```bash
pnpm install
pnpm build
pnpm --filter @ysk/server exec node --import tsx/esm src/cli.ts setup --data-dir .ysk --json
pnpm --filter @ysk/server exec node --import tsx/esm src/cli.ts serve --data-dir .ysk
# 開啟 http://127.0.0.1:9287/（需建置 apps/web 才有完整 UI）
# 或：./install.sh --from-source
```

生產變更：

```bash
export YSK_EXECUTE=1   # 系統層變更通常要以 root 執行
ysk-server readiness --data-dir /var/lib/ysk --json
ysk-server projects deploy --id <UUID> --execute --json
```

## AI 優先用 CLI

```bash
ysk-server help --locale zh-HK
ysk-server readiness --json
ysk-server projects list --json
ysk-server tools --json
```

- [docs/cli/reference-ZH.md](docs/cli/reference-ZH.md) — 完整命令  
- [docs/agent/README-ZH.md](docs/agent/README-ZH.md) · [docs/agent/commands.json](docs/agent/commands.json)  
- [docs/cli/parity-ZH.md](docs/cli/parity-ZH.md) — 面板 ≡ CLI  

全域：`--json`、`--data-dir`、`--config`、`--locale`／`YSK_LOCALE`、`--execute`（危險操作預設 dry-run）。

## 架構一覽

```
apps/web  ──DTO──►  @ysk/shared
apps/server (HTTP + CLI)  ──►  @ysk/core  ──►  @ysk/shared
                                    │
                              dataDir 狀態庫（json|sqlite|postgres）
                              HostExecutor（EXECUTE／root 閘門）
```

詳見：[docs/architecture/overview-ZH.md](docs/architecture/overview-ZH.md)。

## 功能地圖

| 域 | 文件 |
|----|------|
| 專案／部署 | [features/projects-ZH.md](docs/features/projects-ZH.md) |
| 郵件 | [features/email-ZH.md](docs/features/email-ZH.md) |
| 檔案／FTPS | [features/files-ftp-ZH.md](docs/features/files-ftp-ZH.md) |
| 資料庫 | [features/databases-ZH.md](docs/features/databases-ZH.md) |
| DNS／SSL／Nginx | [features/dns-ssl-nginx-ZH.md](docs/features/dns-ssl-nginx-ZH.md) |
| 安全／2FA | [features/security-auth-ZH.md](docs/features/security-auth-ZH.md) |
| 防護 | [features/defense-ZH.md](docs/features/defense-ZH.md) |
| 備份／Cron | [features/backups-cron-ZH.md](docs/features/backups-cron-ZH.md) |
| CDN／Agent | [features/cdn-agents-ZH.md](docs/features/cdn-agents-ZH.md) |
| … | [docs/INDEX-ZH.md](docs/INDEX-ZH.md) |

## 誠實規則

1. 主機變更 CLI **預設 dry-run**。  
2. **已寫入 ≠ 已套用** — `dataDir` 管理檔未 EXECUTE 前不算上線。  
3. 無 root／EXECUTE 時 **fail-closed**，絕不假成功。  
4. **郵件 PTR／Port 25／註冊商 DNS** 屬外部，面板不能代你「完成」。  

見 [docs/architecture/ops-honesty-ZH.md](docs/architecture/ops-honesty-ZH.md)。

## 開發閘門

```bash
pnpm gates
pnpm i18n:check-keys && pnpm i18n:check-glossary
```

## 👤 作者

**Ki (yanshekki)** — 全端工程師、量化交易者，[YSK Limited](https://ysk.hk/) 創辦人。

🌐 [linktr.ee/yanshekki](https://linktr.ee/yanshekki) · 🏢 [ysk.hk](https://ysk.hk/)

### ☕ 支持／打賞

若 **YSK Server** 幫你慳時間管好主機——安全、郵件、站點同誠實運維——歡迎請我飲杯咖啡！

| 網絡 | 地址 |
| --- | --- |
| **EVM** (ETH/BSC/AVAX) | `yanshekki.eth` |
| **NEAR** | `yanshekki.near` |
| **ADA** (Cardano) | `$yanshekki` |

---

## 📄 授權

MIT © Ki (yanshekki)

倉庫：https://github.com/yanshekki/ysk-server

---

由 [YSK Limited](https://ysk.hk/) 提供支持 — 香港遠程開發團隊與企業解決方案
