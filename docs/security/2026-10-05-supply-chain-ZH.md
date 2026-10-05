# 供應鏈覆核 — 2026-10-05

> 語言：中文 | [English](./2026-10-05-supply-chain.md)

YSK Server **1.1.27** 的覆核。鎖檔更新後 `pnpm audit` 只剩 **一** 條公告（`ip`）。1.1.26 預掃裡的其他項目已修好，或已不在依賴樹。

## 範圍

已發布套件 `ysk-server`、`ysk-server-shared`、`ysk-server-core`，私人面板 `apps/web`，pnpm 9.15.9 鎖檔，GitHub Actions，以及 `install.sh`（npm 全域套件、資源校驗、NodeSource）。

## 方法

`pnpm audit`（直接與傳遞）、鎖檔檢查，以及運行時 import 的閱讀。本環境已安裝原生附加元件（`node-pty` 已重編；`bufferutil` 與 `utf-8-validate` 跑了 `node-gyp-build`）。依賴樹裡沒有冒充直接依賴名稱的已知仿冒套件。

## 結果

### 已修復

| 組件 | 嚴重性 | 公告 | 狀態 |
|------|--------|------|------|
| vitest（開發） | 嚴重 | GHSA-5xrq-8626-4rwp | 已在 **4.1.11** 修復（亦覆蓋 3.2.6／4.1.0）。只影響開發伺服器；CI 跑 `vitest run`，不會把 UI 掛到公網。 |
| @vitest/mocker（開發） | 中等 | GHSA-82fw-gwwq-j7x9 | 已在 **4.1.11** 修復。2.x 與 3.x 不再維護，所以由 2.1.8 升到 4.1.11。 |
| vite（開發） | 高 | GHSA-fx2h-pf6j-xcff | 已在 **6.4.3** 修復。不必升到 Vite 7 或 8。 |
| vite／launch-editor／esbuild（開發） | 中等 | esbuild ≤0.24.2，以及預掃裡的 Vite 路徑／launch-editor | 隨 Vite 6.4.3 清除。解析到的 esbuild 是 **0.25.12** 與 **0.28.1**。`pnpm audit` 對兩者都乾淨。 |
| brace-expansion | 高 | GHSA-mh99-v99m-4gvg、GHSA-rgw5-rvv9-x895、GHSA-qhr7-859c-m2p7、GHSA-6j4f-fj2g-mc7p | 升級後已不在解析樹。覆寫仍保留：1.1.21、2.1.7、3.0.9，以及 4.x → 5.0.12。 |
| nanoid | 高 | GHSA-2v37-7h3g-55p8 | 已修復。解析為 **3.3.19**（修補線是 ≥3.3.18）。覆寫亦會把低於 5.1.6 的 4.x／5.x 拉到 **5.1.16**。 |
| ip-address | 中等 | 10.5.0 經 socks／ip-set 的四條公告 | 已修復。覆寫 `ip-address@<10.7.1` → **10.7.3**。 |
| ws | — | 維護 | **8.22.0**（直接依賴）。可選原生 `bufferutil` 與 `utf-8-validate` 用 `node-gyp-build` 編譯。 |
| GitHub Actions | — | 浮動標籤 | 釘在 commit SHA：checkout `11d5960`（v4.4.0）、setup-node `49933ea`（v4.4.0）、pnpm/action-setup `fc06bc1`（v4.4.0）。 |
| install.sh pnpm | — | major &lt; 11 時裝 `pnpm@latest` | 釘在 **pnpm@9.15.9**（與 `packageManager` 相同）。已有的 pnpm 11.x 保留。不會裝 pnpm 12。 |
| install.sh node-gyp-build | — | 未釘版本的 `npm install -g --force` | 釘在 **node-gyp-build@4.8.4**，而且不用 `--force`。 |
| install.sh pm2 | — | `pm2@latest` | 沒有 pm2 時安裝 **pm2@6.0.14**。不會拉入 pm2 7。 |

### 未修復

| 組件 | 嚴重性 | 公告 | 狀態 |
|------|--------|------|------|
| ip 2.0.1 | 高 | GHSA-2p57-rm9w-gvfp | **上游未修**（沒有修補版本）。經 `bittorrent-tracker@11.2.3` 在運行時引入（core 的 WebTorrent 3，以及面板的 WebTorrent 2.8.5）。 |
| NodeSource 安裝腳本 | — | `curl \| bash` 執行 `setup_24.x` | **接受。** 腳本沒有釘死。換掉它會改變 Ubuntu 上安裝 Node 24 的方式。 |
| 資源校驗 | — | 除非 `YSK_INSTALL_REQUIRE_CHECKSUMS=1`，否則可選 | **已減輕，但不是強制。** 下載到 `install/checksums.sha256` 就會核對。檔案不存在時仍警告並繼續，所以對沒有該檔的來源，一行安裝不會 fail closed。 |
| pnpm 10／11／12 | — | 套件管理員主版本 | **延後。** 見下文。鎖檔維持 pnpm 9。 |

`ip` 的實際暴露：`bittorrent-tracker` 只在 `lib/server/parse-udp.js` 呼叫一次 `ip.toString()`，把 UDP announce 裡可選的 32 位元地址轉成點分字串。它**沒有**呼叫 `isPublic`、`isPrivate` 或 `isLoopback`。GHSA-2p57-rm9w-gvfp 講的是這些分類函數判錯，從而在當成對外請求閘門時造成 SSRF。這裡的 peer 地址是 tracker swarm 資料，不是對外請求前的檢查。面板 DDNS 用 `packages/core` 自己的 `isPublicIpv4`／`isPublicIpv6`（不是 `ip` 套件）。沒有加 override：沒有修補版 `ip@2.0.2`，換上未經覆核的 fork 會變成新的供應鏈依賴。等 `bittorrent-tracker` 去掉 `ip` 再處理。

## 延後的升級

| 套件 | 所見最新版 | 為何留住 |
|------|------------|----------|
| TypeScript | 7.0.2 | 主版本。今次只由 5.7.2 升到 **5.9.3**。 |
| Vite | 8.3.2 | 主版本。**6.4.3** 已清掉 GHSA-fx2h-pf6j-xcff，不必做 Vite 7／8 遷移。 |
| React／react-dom | 19.3.0 | 主版本。面板維持 18.3.1。 |
| i18next | 26.4.2 | 主版本。維持 24.2.3；`react-i18next` 維持 15.7.4。 |
| @simplewebauthn／server 與 browser | 14.0.3 | 主版本。server 只由 13.3.2 升到 **13.3.3**。`install.sh` 修復時用 `@simplewebauthn/server@13.3.3`。 |
| webtorrent（apps/web） | 3.0.21 | 2 → 3 是面板那邊點名的破壞性跳躍。面板由 2.5.1 升到 **2.8.5**（仍是 2.x）。core 已是 3.0.21。 |
| pnpm | 12.9.1 | pnpm 12 是破壞性主版本。pnpm 10／11 會重寫鎖檔和 `packageManager`。今次只由 9.15.0 升到 **9.15.9**。 |
| Vitest 5 | 5.0.3 | 4.1.11 已清掉兩條 Vitest 公告。Vitest 5 是下一個主版本，今次不需要。 |
| pm2 | 7.0.4 | 安裝程式釘 6.0.14，新主機不會拿到未驗證的主版本。 |

## 安裝程式與 Actions

`install.sh` 仍以 HTTPS 下載安裝程式庫；`install/checksums.sha256` 存在時會核對（已隨 `stack-ops.sh` 註釋更新而改雜湊）。Node.js 仍來自 NodeSource `setup_24.x`。這條 pipe 是安裝程式剩下的信任邊界。

Actions 維持 v4 線。釘的是 v4.4.0 的 commit，不是會移動的 `v4` 標籤。

## 重查

```bash
pnpm audit
```

預期：一條高嚴重性，`ip` ≤2.0.1，GHSA-2p57-rm9w-gvfp。沒有嚴重。沒有中等。
