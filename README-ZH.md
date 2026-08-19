<p align="center">
  <img src="apps/web/public/logo.svg" width="72" alt="YSK Server" />
</p>

<h1 align="center">YSK Server</h1>

<p align="center">
  <strong>給你自己主機用的 Linux 控制平面。</strong><br />
  網頁面板、CLI 與 API — 在一台 VPS 或實體機上管理網站、電郵、資料、邊緣與防護。
</p>

<p align="center">
  <a href="./README.md">English</a>
  ·
  <a href="https://ysk.hk/">ysk.hk</a>
  ·
  <a href="mailto:email@ysk.hk">email@ysk.hk</a>
  ·
  <a href="https://www.npmjs.com/package/ysk-server">npm</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ysk-server"><img alt="npm ysk-server" src="https://img.shields.io/npm/v/ysk-server.svg?style=flat-square&color=2ea043" /></a>
  <a href="https://github.com/yanshekki/ysk-server/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/yanshekki/ysk-server/actions/workflows/ci.yml/badge.svg?style=flat-square" /></a>
  <img alt="Node.js 22+" src="https://img.shields.io/badge/node-%3E%3D22-58a6ff?style=flat-square" />
  <img alt="13 locales" src="https://img.shields.io/badge/locales-13-58a6ff?style=flat-square" />
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-2ea043?style=flat-square" />
</p>

> 語言：**中文（香港書面語）** · [English](./README.md)

免費、開源、**單機**。不是多租戶面板即服務。你把它裝在自己的機器上；介面、`ysk-server` CLI 與 HTTP API 共用同一核心 — 亦適合 AI agent。

## 為什麼

| 主機屬於你 | 同一控制平面 | 誠實套用 | 生產堆疊 |
|:-----------|:-------------|:---------|:---------|
| 你操作的一台 Linux — VPS 或實體機 | 面板、CLI 與 API 同一模型 | 改主機需要 **root** + `YSK_EXECUTE=1`。預演不會報成功 | 網站、電郵、資料庫、DNS／SSL、防護、Docker |

## 1.1.14 新內容

- **FTP／Galera** — 非法用戶名與無效 IP 有行內錯誤；儲存／產生計劃保持停用。家目錄不會用非法 FTP 名靜默改寫。
- **更新** — 每個套件「套用」帶 `data-confirm`，確認框點名套件。
- **套件** — `ysk-server`、`ysk-server-shared`、`ysk-server-core` 一齊出 **1.1.14**。

## 1.1.13 新內容

- **驗證者／Docker** — compose 指令對齊映像 ENTRYPOINT；Cardano 用 GHCR 11.0.1；執行映像會先探測被佔埠，不會把 bind 失敗殘留當已啟動。
- **Nginx 443** — 有憑證時受管 vhost 保留 `listen 443`；其後同步不會用 :80 範本蓋掉 Let's Encrypt。
- **面板誠實** — 搜尋無命中不是首次安裝空狀態；KPI 用全量；確認框點名目標；名稱規則前後端同一套。
- **套件** — `ysk-server`、`ysk-server-shared`、`ysk-server-core` 一齊出 **1.1.13**。

## 1.1.12 新內容

- **內嵌面板** — 已發布的網頁含質押說明（1.1.11 npm 因 Vite 建置失敗而打進舊畫面）。
- **套件** — `ysk-server`、`ysk-server-shared`、`ysk-server-core` 一齊出 **1.1.12**。

## 1.1.11 新內容

- **驗證者質押說明** — 說明分頁寫明各鏈如何登記質押（只連官方網站）。面板永不保管金鑰。
- **Avalanche** — 實例頁在 RPC 回應後可顯示 NodeID 與 BLS 憑證。
- **套件** — `ysk-server`、`ysk-server-shared`、`ysk-server-core` 一齊出 **1.1.11**。

## 1.1.10 新內容

- **DNS 啟動卡** — PowerDNS 啟動失敗時，結果卡帶綁定／journal 原因，不只寫「失敗」。
- **驗證者** — 勾選主網確認後可按安裝並再確認。說明分頁對照四個設定檔。
- **套件** — `ysk-server`、`ysk-server-shared`、`ysk-server-core` 一齊出 **1.1.10**。

## 1.1.9 新內容

- **叢集總覽** — `/cluster` 留在 `/cluster`（已計劃／已套用表＋四個引擎入口）。不再 302 到 Redis。
- **誠實 overlay** — `install.sh` 複製 dest `package.json`，官方 CLI 升級與 tarball 版本一致。
- **E2E-1118** — 破壞性鍵加上 `data-confirm`、sshd 未自啟時停止控制面文案、矩陣不啟停 UFW、代理「無上線」與逾時分開、leftover／孤立表。

## 1.1.8 新內容

- **誠實 overlay** — dest `package.json` 與 CLI 版本一致。leftover 句子不會說已在運行的 vsftpd／Dovecot 無法啟動。
- **首屏** — 備份、驗證者、Docker 不再先閃空／0。刪容器即刻更新列表。
- **E2E-1117** — 確認鍵 title、Nginx 清 cache 確認、卡住的 agent 運行時、時鐘帶 `UTC±n`、驗證者精靈磁碟文案、`/cluster` 引擎切換。

## 1.1.7 新內容

- **驗證者** — 磁碟用量為驗證者目錄 `du`、啟動中與錯誤分開、軟件分頁拉取釘選映像、Avalanche compose 只傳旗標。
- **時鐘**跟主機時區。**FTP** 預設僅本機，公開明文需打字 `PLAINTEXT`。
- **面板自我更新**可串流 overlay 步驟；殘留探測與頻道檢查不會當成套用失敗。E2E-1116：遷移盤點、VNC 寫 hosts、DNS 啟動結果、公開檔生效／草稿。

[完整變更紀錄](./CHANGELOG.md)

## 面板

<p align="center">
  <img src="docs/assets/screenshots/panel-dashboard-zh-HK.jpg" alt="YSK Server 儀表板 — 服務健康、就緒檢查與套用狀態" width="920" />
</p>
<p align="center"><sub>儀表板 — 即時服務健康、就緒檢查與套用誠實度</sub></p>

<p align="center">
  <img src="docs/assets/screenshots/panel-system-tools-zh-HK.jpg" alt="YSK Server 系統工具 — 身份、面板 HTTPS、網絡與儲存" width="920" />
</p>
<p align="center"><sub>系統工具 — 身份、面板 HTTPS、網絡與儲存</sub></p>

## 安裝

建議 **Ubuntu 22.04／24.04**，以 **root** 執行。其他 Linux：盡力支援。

### 建議做法

```bash
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --non-interactive
```

`install.sh` 會寫入 systemd 單元、啟動 TLS，並**一次性**打印管理員密碼。

### 安裝之後

1. 開啟 **`https://<伺服器IP>:9287`**（首次請接受自簽憑證警告）。
2. 以安裝結尾的帳密登入（亦寫在 `$dataDir/BOOTSTRAP-CREDENTIALS.txt`）。
3. 更改密碼。啟用 2FA。
4. 有域名後，為面板簽發受信任憑證。

### 其他方式

```bash
npm install -g ysk-server
sudo ysk-server setup --admin-user admin --admin-password 'YourStrongPass1!' --data-dir /var/lib/ysk-server
export YSK_EXECUTE=1
sudo ysk-server serve
```

預設弱密碼 `admin` 會被拒絕。全新主機請優先使用 `install.sh`。

```bash
git clone https://github.com/yanshekki/ysk-server.git
cd ysk-server
sudo ./install.sh
```

### 卸載

```bash
sudo ./uninstall.sh --all --keep-data --yes
# 連已登記資料一併清除：
sudo ./uninstall.sh --all --purge-data --yes
```

說明：[安裝](docs/getting-started/install-ZH.md) · [卸載](docs/getting-started/uninstall-ZH.md) · [文件目錄](docs/INDEX-ZH.md)

## 功能

| 範疇 | 已交付 |
|:-----|:-------|
| **網站** | 專案、Git 部署、逐站隔離 |
| **檔案** | 檔案管理、公開分享、WebDAV、FTPS、BT Tracker／WebTorrent |
| **電郵** | 網域、郵箱、投遞檢查（不保證全球入匣） |
| **資料** | MySQL、MariaDB、PostgreSQL、Redis |
| **邊緣** | DNS、SSL、Nginx、Apache、CDN agents |
| **安全** | 防護、SSH／2FA、VPN、VNC |
| **容器** | Docker 引擎 |
| **運維** | 指標、日誌、終端、cron、備份、更新 |
| **驗證者** | L1 節點（Beta） |

## CLI

```bash
ysk-server readiness --json
ysk-server help --locale zh-HK
export YSK_EXECUTE=1    # 真正改主機時必須
```

[CLI 參考](docs/cli/reference-ZH.md) · [agent 命令](docs/agent/commands.json) · [agent skill](.grok/skills/ysk-server/SKILL.md)

## 誠實說明

- 安裝面板**不等於**全球電郵入匣已保證。DNS、PTR 與 25 埠仍須自行處理。
- 危險主機操作維持**預演**，直至 `YSK_EXECUTE=1`。被阻擋的結果不是成功。
- 首次面板憑證為自簽。主機有域名後，請改用 Let’s Encrypt（或你自己的憑證）。

## 支援

YSK Server **免費**。若對你有幫助：

- 面板 **Support**（`/support`）— 作者、贊助、加密貨幣地址
- [Linktree](https://linktr.ee/yanshekki) · GitHub Sponsors
- 加密貨幣：`yanshekki.eth`（EVM）· `yanshekki.near` · `$yanshekki`（ADA）
- 需要代為操作： **YSK Limited** — 請來信（本頁不標價）
- 問題與回報：[email@ysk.hk](mailto:email@ysk.hk)

## 開發

```bash
pnpm install && pnpm build
pnpm --filter ysk-server exec node --import tsx/esm src/cli.ts setup --data-dir .ysk --json
pnpm --filter ysk-server exec node --import tsx/esm src/cli.ts serve --data-dir .ysk
```

架構與貢獻說明見 **[docs/](docs/INDEX-ZH.md)**。

---

<p align="center">
  <strong>YSK Server</strong> · 掌控自己的主機 ·
  <a href="https://ysk.hk/">ysk.hk</a> ·
  <a href="mailto:email@ysk.hk">email@ysk.hk</a>
</p>
