# 安裝

> 語言：中文 | [English](./install.md)

安裝 **YSK Server**（控制平面 + 託管面板 CLI `ysk-server`）。預設會一併安裝面板／CLI **可能會用到的完整系統軟件堆疊**（網頁、郵件、資料庫、DNS、FTP、防禦、語言執行環境）。

| 項目 | 說明 |
|------|------|
| 腳本 | 倉庫根目錄 [`install.sh`](../../install.sh) |
| 目標系統 | **Ubuntu 22.04 / 24.04**（Debian 盡力支援） |
| Node.js | **20+**（若缺失則經 NodeSource 安裝 LTS） |
| 產品套件 | npm 上的 `ysk-server`，或 monorepo `--from-source` |
| 預設模式 | **完整堆疊**（不是只裝控制平面） |

**誠實原則：** 會把套件裝到主機；**多數服務不會被強制啟用**。設定與真正套用仍經面板／CLI，並需 **root** + **`YSK_EXECUTE=1`**。在執行套用之前，**已寫入 ≠ 已生效**。見 [../architecture/ops-honesty-ZH.md](../architecture/ops-honesty-ZH.md)。

---

## 一鍵安裝（建議用於全新 VPS）

需要 root，或可用 `sudo` 執行 `apt` 與 NodeSource。

```bash
# 完整堆疊（預設）：基礎工具 + 託管／郵件／DB／DNS／FTP／防禦 + PHP／Python／Go／Rust 工具 + Node + ysk-server
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash
```

非互動（CI／cloud-init）：

```bash
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --non-interactive
```

由 git 目錄安裝：

```bash
git clone https://github.com/yanshekki/ysk-server.git
cd ysk-server
sudo ./install.sh --non-interactive
# 以此倉庫原始碼建置：
./install.sh --from-source --non-interactive
# 可選：setup 後寫入 systemd unit
./install.sh --from-source --install-systemd --non-interactive
```

---

## 安裝腳本參數

| 參數 | 含義 |
|------|------|
| *（預設）*／`--full` | 安裝產品**可能用到的全部**系統套件 |
| `--minimal` | 只裝基礎依賴 + Node + 產品（不安裝 nginx／郵件／DB／DNS／FTP 堆疊） |
| `--skip-runtimes` | 略過 PHP／Python 額外／Go／Rust／pm2 路徑（仍會裝 Node） |
| `--with-mysql-server` | 安裝 **mysql-server**，而非 **mariadb-server** |
| `--with-clamav` | 一併安裝 ClamAV（體積大；預設關閉） |
| `--non-interactive` | 不詢問；執行 setup 時加 `--force` |
| `--skip-setup` | 只裝套件與產品，不跑 `ysk-server setup` |
| `--upgrade` | 重裝／升級 npm 的 `ysk-server` 套件 |
| `--from-source` | 在目前倉庫執行 `pnpm install && pnpm build`；CLI wrapper 指向 `dist/cli.js` |
| `--install-systemd` | setup 後寫入（若為 root 且 `YSK_EXECUTE=1` 則啟用）控制平面 unit |
| `-h`／`--help` | 顯示說明 |

範例：

```bash
# 僅控制平面（細 VPS／你已自備堆疊）
./install.sh --minimal --non-interactive

# 完整堆疊但不裝 PHP／Go／Rust 工具鏈
./install.sh --full --skip-runtimes

# 完整堆疊 + Oracle MySQL + ClamAV
sudo ./install.sh --with-mysql-server --with-clamav --non-interactive
```

---

## 完整模式會安裝什麼

執行順序：**基礎 → 託管堆疊 → 執行環境 → Node → 全域 npm 工具 → 產品 → setup → 可選 systemd**。

### 1. 系統基礎

`curl`、`git`、`ca-certificates`、`build-essential`、`gnupg`、`software-properties-common`、`apt-transport-https`、`openssl`、`jq`、`unzip`／`zip`、`rsync`、`tar`、`cron`、`logrotate`、`htop`、`net-tools`、`iproute2`、`dnsutils`、`whois`、`lsof`、`procps`、`sudo`、`acl`、`attr`。

### 2. 託管／郵件／DB／DNS／FTP／防禦

| 分組 | 代表套件 |
|------|----------|
| 網頁 + SSL | `nginx`、`apache2`、`certbot`、`python3-certbot-nginx`（軟依賴 `python3-certbot-apache`） |
| 資料庫 | `postgresql` + client、`redis-server` + tools、`sqlite3`；預設 **MariaDB** server+client（或用 `--with-mysql-server` 裝 **MySQL**） |
| 郵件 | `postfix`（預設 debconf「No configuration」）、`dovecot-core`／imapd／pop3d／lmtpd、`opendkim` + tools；軟依賴 `rspamd`；可選 `clamav`／`clamav-daemon` |
| DNS | `pdns-server`、`pdns-backend-bind`；軟依賴 `bind9-dnsutils` |
| FTP | `vsftpd`、`db-util`、`libpam-modules` |
| 防禦 | `ufw`、`fail2ban` |
| 備份／配額 | 軟依賴 `restic`、`quota` |

**軟依賴套件：** 若此發行版找不到該套件，腳本會警告並**繼續**（不會整段中止）。

### 3. 語言執行環境（除非 `--skip-runtimes` 或 `--minimal`）

- PHP：通用 `php` + 常用模組／FPM，以及 8.1／8.2／8.3 版本化軟安裝（視系統可用與否）  
- Python 3 + `pip` + `venv`  
- Go（`golang-go`，軟依賴）  
- 若無 `cargo`／`rustc`，經 **rustup** 非互動安裝（`-y`）  

### 4. Node.js 與全域工具

- 若缺失或版本過舊，經 NodeSource 安裝 Node.js **20.x**  
- 以 npm 全域安裝 **pnpm**、**pm2**  

### 5. 產品本身

| 模式 | 行為 |
|------|------|
| 預設（npm） | `npm install -g ysk-server@latest` |
| `--from-source` | `pnpm install` + `pnpm build`；若已建置 Web UI 則嵌入 `apps/server/public/web`；安裝 CLI wrapper（`/usr/local/bin/ysk-server` 或 `~/.local/bin`） |
| `--upgrade` | 重新全域安裝 npm 套件 |

除非指定 `--skip-setup`，會執行 `ysk-server setup --non-interactive`（若有 `--non-interactive` 會再加 `--force`）。

---

## Monorepo 開發（不跑 install.sh）

```bash
git clone https://github.com/yanshekki/ysk-server.git
cd ysk-server
# 需要 Node 20+ 與 pnpm
pnpm install
pnpm build
pnpm --filter @ysk/web build   # 若由 apps/server 提供 UI，請先建置
pnpm --filter @ysk/server exec node --import tsx/esm src/cli.ts setup --data-dir .ysk --json
pnpm --filter @ysk/server exec node --import tsx/esm src/cli.ts serve --data-dir .ysk
# 開啟 http://127.0.0.1:9287/
```

或對 checkout 使用安裝腳本：

```bash
./install.sh --from-source --minimal   # 真實主機可用 --full
```

---

## 安裝後 — 下一步

```bash
# 1）明確 dataDir（生產環境）
ysk-server setup --non-interactive --data-dir /var/lib/ysk-server
# 首次 setup 可設強密碼：
# YSK_ADMIN_PASSWORD='…' ysk-server setup …

# 2）誠實檢查／就緒度
ysk-server readiness --data-dir /var/lib/ysk-server --json

# 3）啟動控制平面
ysk-server serve --data-dir /var/lib/ysk-server --port 9287
# 或 systemd（變更系統需 EXECUTE，通常還要 root）：
# YSK_EXECUTE=1 sudo -E ysk-server system unit-install --enable --data-dir /var/lib/ysk-server

# 4）開啟 Web UI → 登入 → 啟用 2FA → 建立專案 → 部署

# 5）主機變更（防火牆套用、nginx 上線、套件計劃……）
export YSK_EXECUTE=1
# 主機要求時以 root 執行 CLI
```

常用指令：

```bash
ysk-server --help
ysk-server readiness --json
ysk-server serve --data-dir .ysk --port 9287
ysk-server update --check
```

環境變數：

| 變數 | 作用 |
|------|------|
| `YSK_EXECUTE=1` | 允許系統變更（套用 apt 計劃、ufw、重載服務等） |
| `YSK_ADMIN_PASSWORD` | 首次 setup 的管理員密碼 |
| `YSK_DATA_DIR` | 部分路徑的預設 dataDir 提示 |
| `YSK_LOCALE` | `zh-HK`／`zh-CN`／`en` |

---

## 安裝腳本**不會**做的事

- **不會**保證郵件能進 Gmail／Outlook（PTR、25 埠、DNSBL 仍屬外部因素）。  
- **不會**自動開放防火牆埠或啟用每一個 daemon — 請用面板／CLI 設定。  
- **不會**取代 [setup-ZH.md](./setup-ZH.md)、[readiness-ZH.md](./readiness-ZH.md)、[go-live-ZH.md](./go-live-ZH.md)。  
- **不會**代你安裝多節點 HA peer 或雲端 DNS 註冊商帳號。

---

## 疑難排解

| 現象 | 可嘗試 |
|------|--------|
| `apt-get not found` | 使用 Ubuntu／Debian；腳本以 apt 為準 |
| 軟依賴「unavailable」 | 發行版套件名稱不同；可手動安裝或若不用可忽略 |
| `ysk-server: command not found` | 確認 `PATH` 含 `/usr/local/bin` 或 `~/.local/bin`；或用 `npx ysk-server`／monorepo `dist/cli.js` |
| Node 過舊 | 重跑安裝腳本，或自行安裝 Node 20+ |
| setup 已存在 | 用 `--skip-setup`，或對既有 `--data-dir` 再跑 setup |
| 只需重裝堆疊套件 | 再跑 `./install.sh --skip-setup`（升級產品則用 `--upgrade`） |
| 變更「成功」但主機無變化 | 設 `YSK_EXECUTE=1` 並以 root 執行；見 [../deploy/root-execute-ZH.md](../deploy/root-execute-ZH.md) |

本機檢查腳本語法：

```bash
bash -n install.sh
./install.sh --help
```

---

## 相關文件

| 文件 | 用途 |
|------|------|
| [setup-ZH.md](./setup-ZH.md) | 首次 `setup`／dataDir／管理員 |
| [readiness-ZH.md](./readiness-ZH.md) | 就緒度探測 |
| [go-live-ZH.md](./go-live-ZH.md) | 上線檢查清單 |
| [../deploy/systemd-ZH.md](../deploy/systemd-ZH.md) | 控制平面 unit |
| [../deploy/root-execute-ZH.md](../deploy/root-execute-ZH.md) | root + `YSK_EXECUTE` |
| [../features/runtimes-ZH.md](../features/runtimes-ZH.md) | 經面板／CLI 安裝執行環境 |
| [../architecture/ops-honesty-ZH.md](../architecture/ops-honesty-ZH.md) | 已寫入 ≠ 已生效 |
| [../INDEX-ZH.md](../INDEX-ZH.md) | 完整文件索引 |
