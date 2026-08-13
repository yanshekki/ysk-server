# npm 發布

> 語言：中文 | [English](./npm-publish.md)

## 公開套件（npmjs.com）

| 套件 | 用途 | 連結 |
|------|------|------|
| **`ysk-server`** | 產品 CLI + API + 面板 | https://www.npmjs.com/package/ysk-server |
| **`ysk-server-shared`** | 型別 / locales | https://www.npmjs.com/package/ysk-server-shared |
| **`ysk-server-core`** | 託管 / 安全核心 | https://www.npmjs.com/package/ysk-server-core |

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

新版本前請 bump `packages/shared`、`packages/core`、`apps/server` 的 `package.json` `version`。發布後用 `npm view ysk-server version` 同 `ysk-server help` 驗證。
