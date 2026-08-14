# 安裝

> 語言：中文 | [English](./install.md)

安裝 **YSK Server**（控制平面 CLI `ysk-server`）以及**你揀的主機軟件套餐**（網頁、資料庫、郵件、DNS、FTP、防禦、語言工具鏈）。

| 項目 | 說明 |
|------|------|
| 腳本 | [`install.sh`](../../install.sh) |
| 解除安裝 | [`uninstall.sh`](../../uninstall.sh) · [uninstall-ZH.md](./uninstall-ZH.md) |
| 套餐定義 | [`deploy/stack/bundles.json`](../../deploy/stack/bundles.json)、[`components.json`](../../deploy/stack/components.json) |
| 目標系統 | **Ubuntu 22.04 / 24.04**（Debian 盡力支援） |
| Node.js | **20+** |
| 預設方案 | **`recommended`**（不再默認全裝） |

**誠實原則：** 會裝套件；**多數服務不會強制啟用**。真正套用仍要 **root** + **`YSK_EXECUTE=1`**。見 [../architecture/ops-honesty-ZH.md](../architecture/ops-honesty-ZH.md)。

**日誌：** `/var/log/ysk-server/install-*.log`（root）或 `~/.ysk/logs/`。  
**Manifest：** `$dataDir/stack-manifest.json`（uninstall 靠呢份）。

### HTTPS 引導（首次用 IP 登入）

安裝預設會：

1. `ysk-server setup` 並 **`listenHost=0.0.0.0`**
2. **`ysk-server ssl bootstrap`** — 自簽憑證寫入 `$dataDir/ssl/panel/`（SAN 含 `127.0.0.1`、偵測到的主機 IP、`localhost`）
3. 設定 **`tlsEnabled` + `tlsHttpsOnly`** — 面板 **只開 HTTPS**，埠 **9287**

請開：`https://<伺服器IP>:9287`，並**接受瀏覽器自簽警告**。  
之後有域名再在面板 SSL 換成 Let's Encrypt。

| 旗標 | 意思 |
|------|------|
| `--bootstrap-tls` | 預設：產生引導憑證 |
| `--no-bootstrap-tls` | 僅實驗環境 — 跳過 TLS（HTTP 不安全） |
| `--tls-san 1.2.3.4,5.6.7.8` | 額外寫入憑證 SAN 的 IP |
| `--listen-host 0.0.0.0` | 覆寫 bind 位址 |

CLI（可重跑）：

```bash
ysk-server ssl bootstrap --data-dir /var/lib/ysk-server --force
# Root 安裝預設會 enable + start systemd：
systemctl status ysk-server
# 手動 serve（若已使用 --no-install-systemd）：
ysk-server serve --data-dir /var/lib/ysk-server --port 9287
```

裝完後，用終端打印的面板 URL 登入；帳密在 `$dataDir/BOOTSTRAP-CREDENTIALS.txt`。登入後請改密碼並開 2FA。支援：**email@ysk.hk** · 面板 `/support`。

若 `$dataDir/config.json` 已存在，再跑一次 install **不會**輪換管理員密碼，也不會印新密碼（除非你傳 `--admin-password`）。請用現有帳戶。

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
6. **systemd** — **root 預設 ON**（enable + start 面板）
7. **確認摘要** → 安裝 → 驗證 → 寫 manifest → **打印登入憑證**

---

## 一鍵／非互動

```bash
# 非互動預設 = recommended；root 時會裝完即起 ysk-server
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --non-interactive

# 全部套餐
./install.sh --non-interactive --plan full

# 自訂套餐
./install.sh --non-interactive --bundles control-plane,web,defense
```

`curl|bash` 通常無 TTY → 自動 non-interactive，預設 **`recommended`**（要用全裝請加 `--plan full`）。

### 只升級面板（不要重裝 SQL）

`--upgrade` 會把官方 npm tarball overlay 到執行中 `ExecStart` 目錄，然後重啟 `ysk-server`。**不會** apt 安裝 MariaDB／MySQL。面板「套用面板更新」無法自行套用時，請用此命令。

```bash
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --upgrade
```

主機 `/var/lib/mysql` 已是 **MySQL 8** 資料的話，不要使用 `--upgrade-stack` 或預設 `recommended` 去裝 MariaDB——dpkg 會嘗試改名資料目錄然後失敗。

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
| `--non-interactive` | 不詢問 |
| `--with-mysql-server` | 用 MySQL 代替 MariaDB |
| `--with-clamav` | email 時一併裝 ClamAV |
| `--from-source` | 用目前 git 目錄建置 |
| `--install-systemd` | setup 後寫 unit（**root 預設已 ON**） |
| `--no-install-systemd` | 跳過 systemd（之後手動 serve） |
| `--admin-password PASS` | 初始 admin 密碼（預設隨機強密碼） |
| `--admin-user NAME` | 初始 admin 用戶名（預設 `admin`） |
| `--data-dir PATH` | 面板資料 + manifest |
| `--full`／`--minimal` | 等同對應 plan |

---

## 解除安裝

```bash
# 推薦：卸 stack + 產品 CLI／unit，保留資料
sudo ./uninstall.sh --all --keep-data --yes
# 危險：連白名單資料一齊清
sudo ./uninstall.sh --all --purge-data --yes
```

`--all` **預設會移除產品**（CLI + unit），除非加 `--keep-product`。詳見 [uninstall-ZH.md](./uninstall-ZH.md)。

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

1. 開終端打印的 **`https://<IP>:9287`**（接受自簽警告）
2. 用 **BOOTSTRAP-CREDENTIALS.txt**（或安裝結尾打印）登入 → 改密碼 → 開 2FA
3. `ysk-server readiness --json`（可選檢查）
4. 主機變更：`export YSK_EXECUTE=1`（通常要 root）
5. 問題／贊助：面板 **`/support`** · **email@ysk.hk**
