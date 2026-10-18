# 供應鏈覆核 — 2026-10-18

> 語言：中文 | [English](./2026-10-18-supply-chain.md)

YSK Server **1.1.29** 的覆核。鎖檔更新後 `pnpm audit` 只剩 **一** 條公告（`ip`）。1.1.28 之後沒有新公告。1.1.28 的修補仍然有效。

## 範圍

已發布套件 `ysk-server`、`ysk-server-shared`、`ysk-server-core`，私人面板 `apps/web`，pnpm 9.15.9 鎖檔，GitHub Actions，以及 `install.sh`（npm 全域套件、資源校驗、NodeSource）。

## 方法

`pnpm audit`（直接與傳遞）、`pnpm outdated -r`、鎖檔檢查，以及運行時 import 的閱讀。本環境有原生附加元件（`node-pty` 預編譯；`bufferutil` 與 `utf-8-validate` 經 `node-gyp-build@4.8.4`）。依賴樹裡沒有冒充直接依賴名稱的已知仿冒套件。

## 結果

### 已修復

| 組件 | 嚴重性 | 公告 | 狀態 |
|------|--------|------|------|
| vitest／@vitest/coverage-v8（開發） | — | 維護 | **4.1.12**（仍是 4.x）。不必升到 Vitest 5。 |
| playwright-core | — | 維護 | **1.64.1**。 |
| sql.js | — | 維護 | **1.15.0**（SQLite wasm 3.54.0）。套件仍帶 asm.js；儲存層仍載入 `sql.js/dist/sql-asm.js`。 |
| @testing-library/user-event（開發） | — | 維護 | **14.6.8**。 |
| nanoid 3.x（開發覆寫） | — | 維護 | 覆寫 `nanoid@>=3 <3.3.20` → **3.3.20**。3.3.19 的「過大 user ID」修補仍然有效；3.3.20 是類型修補。 |
| ip-address（覆寫） | — | 維護 | 覆寫 `ip-address@<10.7.4` → **10.7.4**。原先 CVE 下限（≥10.7.1）仍然有效。 |
| esbuild（tsx，開發） | — | 維護 | 經 tsx `~0.28.0` 升到 **0.28.2**。Vite 維持 **0.25.12**（`esbuild@<=0.24.2` 覆寫沒有改）。 |
| 1.1.28 修補 | — | 仍然有效 | `source-map-js` **1.2.2**、Vite **6.4.4**、happy-dom **20.14.6**、Vitest 4.x 公告、`brace-expansion`／nanoid 5.x／`esbuild` ≤0.24.2 覆寫、Actions SHA 釘死、`install.sh` 的 `pnpm@9.15.9`／`node-gyp-build@4.8.4`／`pm2@6.0.14`。 |

### 未修復

| 組件 | 嚴重性 | 公告 | 狀態 |
|------|--------|------|------|
| ip 2.0.1 | 高 | GHSA-2p57-rm9w-gvfp | **上游未修**（沒有修補版本；最新仍是 2.0.1）。經 `bittorrent-tracker@11.2.3` 在運行時引入（core 的 WebTorrent 3.0.21，以及面板的 WebTorrent 2.8.5）。 |
| NodeSource 安裝腳本 | — | `curl \| bash` 執行 `setup_24.x` | **接受。** 腳本沒有釘死。換掉它會改變 Ubuntu 上安裝 Node 24 的方式。 |
| 資源校驗 | — | 除非 `YSK_INSTALL_REQUIRE_CHECKSUMS=1`，否則可選 | **已減輕，但不是強制。** 下載到 `install/checksums.sha256` 就會核對。檔案不存在時仍警告並繼續，所以對沒有該檔的來源，一行安裝不會 fail closed。 |
| pnpm 10／11／12 | — | 套件管理員主版本 | **延後。** 見下文。鎖檔維持 pnpm 9。 |

`ip` 的實際暴露：`bittorrent-tracker` 只在 `lib/server/parse-udp.js` 呼叫一次 `ip.toString()`，把 UDP announce 裡可選的 32 位元地址轉成點分字串。它**沒有**呼叫 `isPublic`、`isPrivate` 或 `isLoopback`。GHSA-2p57-rm9w-gvfp 講的是這些分類函數判錯，從而在當成對外請求閘門時造成 SSRF。這裡的 peer 地址是 tracker swarm 資料，不是對外請求前的檢查。面板 DDNS 用 `packages/core` 自己的 `isPublicIpv4`／`isPublicIpv6`（不是 `ip` 套件）。沒有加 override：沒有修補版 `ip@2.0.2`，換上未經覆核的 fork 會變成新的供應鏈依賴。等 `bittorrent-tracker` 去掉 `ip` 再處理。

## 延後的升級

| 套件 | 所見最新版 | 為何留住 |
|------|------------|----------|
| TypeScript | 7.0.2 | 主版本。維持 **5.9.3**。 |
| Vite | 8.3.4 | 主版本。**6.4.4** 仍是 6.x 最新。沒有 6.x 公告逼我們做 Vite 7／8 遷移。 |
| React／react-dom | 19.3.1 | 主版本。面板維持 18.3.1。 |
| i18next | 26.5.2 | 主版本。維持 24.2.3；`react-i18next` 維持 15.7.4。 |
| @simplewebauthn／server 與 browser | 14.0.3 | 主版本。server 維持 **13.3.3**；browser 維持 **13.3.0**（13.x 最新）。`install.sh` 修復時仍用 `@simplewebauthn/server@13.3.3`。 |
| webtorrent（apps/web） | 3.0.21 | 2 → 3 是面板那邊點名的破壞性跳躍。面板維持 **2.8.5**。core 已是 3.0.21。 |
| pnpm | 12.14.0 | pnpm 12 是破壞性主版本。pnpm 10／11 會重寫鎖檔和 `packageManager`。維持 **9.15.9**。 |
| Vitest 5 | 5.0.5 | 4.1.12 仍留在已清掉 Vitest 公告的 4.x 線。Vitest 5 是下一個主版本，今次不需要。 |
| pm2 | 7.0.4 | 安裝程式釘 6.0.14，新主機不會拿到未驗證的主版本。 |

今次亦不升（主版本或產品線跳躍）：`@types/node` 22 → 26、`@vitejs/plugin-react` 4 → 6、`react-i18next` 15 → 17、happy-dom 20 → **21.0.3**。

## 安裝程式與 Actions

`install.sh` 仍以 HTTPS 下載安裝程式庫；`install/checksums.sha256` 存在時會核對。Node.js 仍來自 NodeSource `setup_24.x`。這條 pipe 是安裝程式剩下的信任邊界。釘死的版本沒有改：`pnpm@9.15.9`、`node-gyp-build@4.8.4`、`pm2@6.0.14`。

Actions 維持 v4 線。釘的是 v4.4.0 的 commit，不是會移動的 `v4` 標籤。

## 重查

```bash
pnpm audit
```

預期：一條高嚴重性，`ip` ≤2.0.1，GHSA-2p57-rm9w-gvfp。沒有嚴重。沒有中等。`source-map-js` 已不在報告裡。
