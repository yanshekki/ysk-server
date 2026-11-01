# 供應鏈覆核 — 2026-11-01

> 語言：中文 | [English](./2026-11-01-supply-chain.md)

YSK Server **1.1.33** 的覆核。鎖檔更新後 `pnpm audit` 只剩 **一** 條公告（`ip`）。1.1.32 之後沒有新的 npm 公告。Dependabot 第 1 號警報就是這條 `ip`。當時沒有未合併的 pull request。

## 範圍

已發布套件 `ysk-server`、`ysk-server-shared`、`ysk-server-core`，私人面板 `apps/web`，pnpm 9.15.9 鎖檔（`lockfileVersion` 9.0），GitHub Actions，以及 `install.sh` 連同它下載的安裝程式庫（`install/lib/*.sh`：NodeSource、rustup、Bun，以及 Kotlin 編譯器 zip）。

## 方法

`pnpm audit`（400 個依賴：1 高、0 嚴重、0 中、0 低）、`pnpm outdated -r`、對直接依賴同安裝程式釘死版本做 `npm view`、鎖檔檢查、GitHub Actions 標籤對應的 commit，以及閱讀 `bittorrent-tracker@11.2.3` 的 `lib/server/parse-udp.js`。這棵樹裡的原生附加元件：`node-pty@1.1.0`（預編譯；`install.sh` 會跑 `npm rebuild node-pty`）、`ws` 的可選 peer `bufferutil@4.1.0` 與 `utf-8-validate@6.0.6`（經 `node-gyp-build@4.8.4`），以及 WebTorrent 的 `node-datachannel@0.32.3`（帶已棄用的 `prebuild-install@7.1.3`）。`fetch-blob` 帶已棄用的 `node-domexception@1.0.0`。這兩個棄用都不是 audit 發現。`sql.js` 是 asm／WASM，不是 Node 原生附加元件。儲存層仍載入 `sql.js/dist/sql-asm.js`。1.15.2 會印棄用警告並指向 `sql-wasm-inline.js`；今次沒有改載入器。依賴樹裡沒有冒充直接依賴名稱的已知仿冒套件。

GitHub secret scanning 同 push protection 已啟用。Dependabot security updates 已啟用。Code scanning 沒有分析設定。Discussions 已啟用。

## 結果

### 已修復

| 組件 | 嚴重性 | 公告 | 狀態 |
|------|--------|------|------|
| Roundcube 預設 | 高（上游） | Roundcube 1.7.5 安全發布，2026-10-19 | **1.7.5**。新的 webmail 安裝，以及產生出嚟的 `install-roundcube.sh` 預設，由 **1.7.2** 改走這版。上游說明包括 IMAP 指令注入、SSRF 過濾繞過（NAT64）、遠端內容同 XSS、mark-as-junk 的 CSRF 繞過，以及 session 物件注入。`roundcubemail-1.7.5-complete.tar.gz` 回 HTTP 200。已經喺磁碟上的目錄，要再裝一次 webmail 先會換。 |
| @simplewebauthn/server 修復 | — | 1.1.32 之後安裝程式落後 | **14.0.3**。core 升到 14 之後，`install.sh` 喺模組缺失時仍裝 **13.3.3**。安裝程式 smoke 而家要求修復釘同 `packages/core` 一致。 |
| ws | — | 維護 | **8.22.1**。IPC URL 路徑唔再喺 `:` 被截斷。Node 有 `http.websocketMask`／`websocketUnmask` 時會用它們做遮罩。 |
| sql.js | — | 維護 | **1.15.2**。匯出改用 SQLite backup API，來源連線保持開住。asm.js 構建仍然附帶。 |
| react-router-dom | — | 維護 | **7.18.5**。路由清單處理對昂貴的祖先展開加了上限。turbo-stream 解碼檢查更嚴。面板是 Vite SPA。 |
| i18next | — | 維護 | **26.6.0**（鎖檔原本是 26.5.11）。`strictInterpolationChecks` 預設 false。面板保持 `enableSelector: false`，字串 key 仍然是字串。 |
| @types/node | — | 維護 | **26.6.6**。只是開發用型別。執行時 engines 仍是 Node ≥22。CI 仍是 Node 24。 |
| 先前修補 | — | 仍然有效 | happy-dom **21.0.4**、`source-map-js` **1.2.2**、`ip-address` **10.7.5**、brace-expansion 同 nanoid 覆寫、Vitest **5.0.5**、Vite **8.3.5**、SimpleWebAuthn server **14.0.3** 同 browser **14.0.0**。 |

### 未修復

| 組件 | 嚴重性 | 公告 | 狀態 |
|------|--------|------|------|
| ip 2.0.1 | 高 | GHSA-2p57-rm9w-gvfp | **上游未修。** 最新仍是 2.0.1（registry `modified` 2025-10-13）。沒有 `2.0.2`。Dependabot 警報 #1。經 `bittorrent-tracker@11.2.3`（最新；仍是 `ip@^2.0.1`）由 core 同面板 WebTorrent **3.0.21** 引入。 |
| NodeSource 安裝腳本 | — | `curl \| bash` 執行 `setup_24.x` | **接受。** `install/lib/stack-ops.sh` 把 `https://deb.nodesource.com/setup_24.x` pipe 去 shell。腳本沒有釘死。換掉它會改變 Ubuntu 上安裝 Node 24 的方式。 |
| rustup／Bun | — | `curl \| bash` | **接受。** 只在可選堆疊元件：`https://sh.rustup.rs` 同 `https://bun.sh/install`。不是預設安裝路徑。 |
| 資源校驗 | — | 除非 `YSK_INSTALL_REQUIRE_CHECKSUMS=1`，否則可選 | **已減輕，但不是強制。** 下載到 `install/checksums.sha256` 就會核對。檔案不存在時仍警告並繼續。 |
| pnpm 10／11／12 | — | 套件管理員主版本 | **延後。** 9.x 最新是 **9.15.9**。pnpm 12.17.0 會重寫鎖檔同 `packageManager` 釘。 |
| TypeScript 6／7 | — | 主版本 | **延後。** 5.x 最新是 **5.9.3**。整體最新是 **7.0.2**（亦有 6.0.3）。 |
| npm CLI 12 | — | 主版本 | **延後。** 發布工作流程維持 **npm@11.21.1**（11.x 最新）。不用 npm 12.2.1。發布仍走 Trusted Publisher OIDC。不用 npm token。 |
| pm2 7 | — | 主版本 | **延後。** 安裝程式釘 **6.0.14**（6.x 最新）。整體最新是 7.1.1。 |

`ip` 的實際暴露，今次對 `bittorrent-tracker@11.2.3` 再讀過：`lib/server/parse-udp.js` 只呼叫一次 `ip.toString()`，把 UDP announce 裡可選的 32 位元地址轉成點分字串。它沒有呼叫 `isPublic`、`isPrivate` 或 `isLoopback`。GHSA-2p57-rm9w-gvfp 講的是這些分類函數判錯。這裡的 peer 地址是 tracker swarm 資料，不是對外請求前的檢查。面板 DDNS 用 `packages/core` 自己的 `isPublicIpv4`／`isPublicIpv6`（不是 `ip` 套件）。沒有加 override：沒有修補版 `ip@2.0.2`，換上未經覆核的 fork 會變成新的供應鏈依賴。等 `bittorrent-tracker` 去掉 `ip` 再處理。

## 延後的升級

| 套件 | 所見最新版 | 為何留住 |
|------|------------|----------|
| TypeScript | 7.0.2 | 主版本（6.0.3 同 7.0.2）。維持 **5.9.3**。 |
| pnpm | 12.17.0 | 破壞性主版本。9.x 最新是 **9.15.9**。 |
| npm CLI | 12.2.1 | 主版本。發布工作流程維持 **11.21.1**。 |
| pm2 | 7.1.1 | 安裝程式釘 **6.0.14**，新主機不會拿到未驗證的主版本。 |
| nanoid | 6.0.2 | 主版本。樹裡解析到 **3.3.20**。覆寫仍把有漏洞的 3.x／4.x／5.x 範圍抬到 3.3.20／5.1.16。5.1.16 是 5.x 最新。 |
| sql.js 載入器 | wasm-inline | 1.15.2 棄用 asm.js，但仍附帶 `sql-asm.js`。儲存層繼續用這條路徑。換載入器是執行時改動，不是今次修補。 |
| SnappyMail 標籤 2.38.2.1 | 只得 docker | 標籤說明係為 `djmaze/snappymail` 映像釘 PHP 8.2.35，對應 CVE-2026-109618／CVE-2026-109619（[snappymail#2085](https://github.com/the-djmaze/snappymail/issues/2085)）。沒有 `snappymail-2.38.2.1.tar.gz`（HTTP 404）。YSK 把 **2.38.2** 應用程式 tarball 裝到主機 PHP，不是那個映像。 |
| Kotlin 編譯器 zip | 沒有改 | 可選堆疊安裝釘 **2.1.0**，後備 **2.0.21**。不是預設 `install.sh` 下載。今次沒有經覆核的安全修補要求換編譯器線。 |

已核對而且已經是最新的直接依賴：Vitest **5.0.5**、Vite **8.3.5**、`@vitejs/plugin-react` **6.1.2**、happy-dom **21.0.4**、playwright-core **1.64.1**、WebTorrent **3.0.21**、`bittorrent-tracker` **11.2.3**、`node-pty` **1.1.0**、`node-gyp-build` **4.8.4**、React **19.3.1**、`react-i18next` **17.1.9**、tsx **4.23.15**、maxmind **5.0.7**。解析到的 esbuild 是 **0.28.2**。覆寫仍把 `esbuild@<=0.24.2` 抬到 **0.25.12**（0.25.x 最新）。

## 安裝程式與 Actions

`install.sh` 仍以 HTTPS 從 `raw.githubusercontent.com` 下載安裝程式庫（預設分支 `main`；`YSK_INSTALL_RAW` 可以釘一個 commit），`install/checksums.sha256` 存在時會核對。套件下載後備是 `https://registry.npmjs.org/ysk-server/-/ysk-server-<version>.tgz`。全域釘：`pnpm@9.15.9`、`node-gyp-build@4.8.4`、`pm2@6.0.14`，修復用 `@simplewebauthn/server@14.0.3`。

下載落嚟的 `install/lib/stack-ops.sh` 仍會 pipe NodeSource `setup_24.x`、rustup 同 Bun，以及下載 Kotlin 編譯器 zip。這些 pipe 是安裝程式剩下的信任邊界。校驗蓋的是程式庫檔案本身，不是那些程式庫再 curl 的第三方腳本。

Actions 仍然用 SHA 釘在當前發布 commit，不是會移動的標籤。今個星期這三個都沒有更新的發布。

| Action | 釘 | 發布 |
|--------|-----|------|
| actions/checkout | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1（2026-07-17） |
| actions/setup-node | `949feb2413d6458794dcd2491c4babbbce0c15c1` | v7.1.0（2026-10-08） |
| pnpm/action-setup | `ea17c68df8912ef543352723c149a84f56e3d413` | v6.1.0（annotated tag；commit 2026-09-04） |

發布工作流程的 npm CLI 是 **11.21.1**。npm 11 警告 `bin[ysk-server] ... invalid and removed` 是誤報，忽略。

## 重查

```bash
pnpm audit
```

預期：一條高嚴重性，`ip` ≤2.0.1，GHSA-2p57-rm9w-gvfp。沒有嚴重。沒有中等。
