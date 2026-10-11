# 供應鏈覆核 — 2026-10-11

> 語言：中文 | [English](./2026-10-11-supply-chain.md)

YSK Server **1.1.28** 的覆核。鎖檔更新後 `pnpm audit` 只剩 **一** 條公告（`ip`）。1.1.27 之後新出現的 `source-map-js` 高嚴重性已修好。1.1.27 的修補仍然有效。

## 範圍

已發布套件 `ysk-server`、`ysk-server-shared`、`ysk-server-core`，私人面板 `apps/web`，pnpm 9.15.9 鎖檔，GitHub Actions，以及 `install.sh`（npm 全域套件、資源校驗、NodeSource）。

## 方法

`pnpm audit`（直接與傳遞）、`pnpm outdated -r`、鎖檔檢查，以及運行時 import 的閱讀。本環境已安裝原生附加元件（`node-pty` 已重編；`bufferutil` 與 `utf-8-validate` 跑了 `node-gyp-build`）。依賴樹裡沒有冒充直接依賴名稱的已知仿冒套件。

## 結果

### 已修復

| 組件 | 嚴重性 | 公告 | 狀態 |
|------|--------|------|------|
| source-map-js（開發） | 高 | GHSA-68fv-2mgg-jv7q | 1.1.27 之後新出現。索引 source map 偏移可卡住事件迴圈（CVE-2026-93749）。覆寫 `source-map-js@<1.2.2` → **1.2.2**。路徑是 Vitest coverage 底下的 Vite／PostCSS／magicast。只影響開發。 |
| vite（開發） | — | 維護 | **6.4.4**（仍是 6.x）。GHSA-fx2h-pf6j-xcff 自 6.4.3 起已清掉。不必升到 Vite 7 或 8。 |
| happy-dom（開發） | — | 維護 | **20.14.6**。 |
| playwright-core | — | 維護 | **1.64.0**。 |
| 1.1.27 修補 | — | 仍然有效 | Vitest **4.1.11**、Vite 6.x 公告、`brace-expansion`／`nanoid`／`ip-address`／`esbuild` 覆寫、Actions SHA 釘死、`install.sh` 的 `pnpm@9.15.9`／`node-gyp-build@4.8.4`／`pm2@6.0.14`。 |

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
| Vite | 8.3.4 | 主版本。**6.4.4** 是 6.x 修補。沒有 6.x 公告逼我們做 Vite 7／8 遷移。 |
| React／react-dom | 19.3.0 | 主版本。面板維持 18.3.1。 |
| i18next | 26.4.3 | 主版本。維持 24.2.3；`react-i18next` 維持 15.7.4。 |
| @simplewebauthn／server 與 browser | 14.0.3 | 主版本。server 維持 **13.3.3**；browser 維持 **13.3.0**（13.x 最新）。`install.sh` 修復時仍用 `@simplewebauthn/server@13.3.3`。 |
| webtorrent（apps/web） | 3.0.21 | 2 → 3 是面板那邊點名的破壞性跳躍。面板維持 **2.8.5**。core 已是 3.0.21。 |
| pnpm | 12.11.2 | pnpm 12 是破壞性主版本。pnpm 10／11 會重寫鎖檔和 `packageManager`。維持 **9.15.9**。 |
| Vitest 5 | 5.0.3 | 4.1.11 已清掉兩條 Vitest 公告。Vitest 5 是下一個主版本，今次不需要。 |
| pm2 | 7.0.4 | 安裝程式釘 6.0.14，新主機不會拿到未驗證的主版本。 |

## 安裝程式與 Actions

`install.sh` 仍以 HTTPS 下載安裝程式庫；`install/checksums.sha256` 存在時會核對。Node.js 仍來自 NodeSource `setup_24.x`。這條 pipe 是安裝程式剩下的信任邊界。釘死的版本沒有改：`pnpm@9.15.9`、`node-gyp-build@4.8.4`、`pm2@6.0.14`。

Actions 維持 v4 線。釘的是 v4.4.0 的 commit，不是會移動的 `v4` 標籤。

## 重查

```bash
pnpm audit
```

預期：一條高嚴重性，`ip` ≤2.0.1，GHSA-2p57-rm9w-gvfp。沒有嚴重。沒有中等。`source-map-js` 已不在報告裡。
