# 安裝

> 語言：中文 | [English](./install.md)

安裝 **YSK Server**（控制平面 CLI `ysk-server`）以及**你揀嘅主機軟件套餐**（網頁、資料庫、郵件、DNS、FTP、防禦、語言工具鏈）。

| 項目 | 說明 |
|------|------|
| 腳本 | [`install.sh`](../../install.sh) |
| 解除安裝 | [`uninstall.sh`](../../uninstall.sh) · [uninstall-ZH.md](./uninstall-ZH.md) |
| 套餐定義 | [`deploy/stack/bundles.json`](../../deploy/stack/bundles.json)、[`components.json`](../../deploy/stack/components.json) |
| 目標系統 | **Ubuntu 22.04 / 24.04**（Debian 盡力支援） |
| Node.js | **20+** |
| 預設方案 | **`recommended`**（唔再默認全裝） |

**誠實原則：** 會裝套件；**多數服務唔會強制啟用**。真正套用仍要 **root** + **`YSK_EXECUTE=1`**。見 [../architecture/ops-honesty-ZH.md](../architecture/ops-honesty-ZH.md)。

**日誌：** `/var/log/ysk-server/install-*.log`（root）或 `~/.ysk/logs/`。  
**Manifest：** `$dataDir/stack-manifest.json`（uninstall 靠呢份）。

---

## 互動嚮導（建議用於 VPS）

```bash
git clone https://github.com/yanshekki/ysk-server.git
cd ysk-server
sudo ./install.sh
```

步驟：

1. **方案** — 推薦 / 全部 / 僅控制平面 / **自訂多選套餐**
2. **SQL**（有 database）— MariaDB（預設）**或** MySQL（互斥）  
   面板一鍵安裝若偵測到對方已安裝，會彈出 **互斥切換** 確認（輸入 `SWITCH`）：先 logical dump 用戶庫 → 卸載對方 → 安裝目標 → 匯入。**不可** 兩引擎並存；直接 apt 會被後端拒絕（`needs_exclusive_switch`）。
3. **ClamAV**（有 email）— 可選大型套件
4. **產品來源** — npm 全域或 `--from-source`
5. **資料目錄** — 預設 `/var/lib/ysk-server` 或 `~/.ysk`
6. **systemd** — 可選寫 unit
7. **確認摘要** → 安裝 → 只驗證已選組件 → 寫 manifest

---

## 一鍵／非互動

```bash
# 非互動預設 = recommended
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --non-interactive

# 全部套餐
./install.sh --non-interactive --plan full

# 自訂套餐
./install.sh --non-interactive --bundles control-plane,web,defense
```

`curl|bash` 通常無 TTY → 自動 non-interactive，預設 **`recommended`**（要用全裝請加 `--plan full`）。

---

## 方案（Plans）

| 方案 | 套餐 |
|------|------|
| `minimal` | 只有 `control-plane` |
| `recommended`（預設） | 控制平面 + web + database + defense |
| `full` | 全部套餐 |
| `custom` | `--bundles` 或嚮導多選 |

### 套餐一覽

| 套餐 | 內容摘要 |
|------|----------|
| `control-plane` | 基礎工具、git、Node 20+、`ysk-server`（**必選**） |
| `web` | nginx（對外 :80/:443）、apache2（PHP 後端 `127.0.0.1:8080`）、certbot、PHP |
| `database` | MariaDB **或** MySQL、PostgreSQL、Redis、clients、sqlite |
| `email` | postfix、dovecot、opendkim；可選 rspamd／ClamAV |
| `dns` | PowerDNS |
| `ftp` | vsftpd、db-util |
| `defense` | ufw、fail2ban |
| `runtimes` | PHP、Python、Go、Rust |

---

## 常用參數

| 參數 | 含義 |
|------|------|
| `--plan NAME` | `minimal`／`recommended`／`full` |
| `--bundles LIST` | 逗號分隔套餐 id |
| `--non-interactive` | 唔詢問 |
| `--with-mysql-server` | 用 MySQL 代替 MariaDB |
| `--with-clamav` | email 時一併裝 ClamAV |
| `--from-source` | 用目前 git 目錄建置 |
| `--install-systemd` | setup 後寫 unit |
| `--data-dir PATH` | 面板資料 + manifest |
| `--full`／`--minimal` | 等同對應 plan |

---

## 解除安裝

```bash
sudo ./uninstall.sh
sudo ./uninstall.sh --bundles email --keep-data --yes
```

詳見 [uninstall-ZH.md](./uninstall-ZH.md) — 可部份／全部移除，**保留或清除資料**。

### CLI（產品已安裝後）

```bash
ysk-server stack plans --json
ysk-server stack status --data-dir /var/lib/ysk-server --json
ysk-server stack install --plan recommended --data-dir /var/lib/ysk-server --json   # dry-run
YSK_EXECUTE=1 sudo ysk-server stack install --yes --plan recommended --data-dir /var/lib/ysk-server
YSK_EXECUTE=1 sudo ysk-server stack uninstall --yes --bundles email --data-dir /var/lib/ysk-server
```

### 面板

**服務 → Stack／套餐** 分頁：方案／套餐嚮導、dry-run、安裝、移除（keep／purge）。

---

## 安裝後下一步

1. `ysk-server setup --non-interactive --data-dir /var/lib/ysk-server`
2. `ysk-server readiness --json`
3. `ysk-server serve --data-dir /var/lib/ysk-server --port 9287`
4. 開 Web UI → 登入 → 開 2FA  
5. 主機變更：`export YSK_EXECUTE=1`
