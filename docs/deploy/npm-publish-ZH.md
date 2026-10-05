# npm 發布

> 語言：中文 | [English](./npm-publish.md)

## 公開套件（npmjs.com）

| 套件 | 用途 | 連結 |
|------|------|------|
| **`ysk-server`** | 產品 CLI + API + 面板 | https://www.npmjs.com/package/ysk-server |
| **`ysk-server-shared`** | 型別 / locales（**與產品同一版本**） | https://www.npmjs.com/package/ysk-server-shared |
| **`ysk-server-core`** | 託管 / 安全核心（**與產品同一版本**） | https://www.npmjs.com/package/ysk-server-core |

用戶安裝：

```bash
npm install -g ysk-server
```

> 說明：registry **不用** `@ysk-server/*` 呢類 scope（要建 npm org）。
> 免費帳號用 **unscoped** 套件名（不必 org）。

## 發布

```bash
bash scripts/publish-ysk-server-npm.sh --publish
```

順序：**shared → core → ysk-server**（server 會 bundle shared+core）。

每個套件都帶 **README.md**，方便 npm 產品頁顯示。

新版本前請把 `packages/shared`、`packages/core`、`apps/server` 的 `package.json` `version` 調成**同一個號碼**。三個不一致時發布腳本會拒絕。發布後用 `npm view ysk-server version`、`npm view ysk-server-shared version`、`npm view ysk-server-core version` 同 `ysk-server help` 驗證。

## 可信發布

推送標籤 `v*.*.*` 會跑 [`.github/workflows/release.yml`](../../.github/workflows/release.yml)。在同一標籤上 `workflow_dispatch` 亦會跑。任務用 npm **Trusted Publishing**（GitHub OIDC）：`permissions: id-token: write` 同 `contents: read`，Node 24，npm 11.21.0，然後 `npm publish --provenance --access public`。

順序一樣：**shared → core → ysk-server**。registry 已有該版本就跳過。工作流程**不會**讀 `NPM_TOKEN` 或 `NODE_AUTH_TOKEN`。

第一次打標籤前，請在 npmjs.com 為三個套件各加 Trusted Publisher：GitHub Actions、owner `yanshekki`、repository `ysk-server`、workflow 檔名 `release.yml`。

上面的手動腳本沒有改，仍然可以用 npm 登入發布。
