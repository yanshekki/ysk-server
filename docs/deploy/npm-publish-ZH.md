# npm 發布

> 語言：中文 | [English](./npm-publish.md)

## 公開套件

| 套件 | 用途 | 安裝 |
|------|------|------|
| **`ysk-server`** | 控制面 API + CLI `ysk-server` | `npm install -g ysk-server` |

產品頁：**https://www.npmjs.com/package/ysk-server**

### Monorepo（只係 workspace 名）

| 套件 | 用途 |
|------|------|
| `@ysk-server/shared` | 型別 / locales |
| `@ysk-server/core` | 託管 / 安全邏輯 |
| `@ysk-server/web` | 面板 SPA（private；打包時嵌入） |
| `ysk-server` | 對外發布嘅 CLI + API |

`@ysk-server/shared` / `@ysk-server/core` 會 **bundle 入** `ysk-server` tarball，用戶唔使裝 scoped 包，亦**唔使**建 npm org。

## 發布

```bash
bash scripts/publish-ysk-server-npm.sh --publish
```

## 驗證

```bash
npm view ysk-server version
npm install -g ysk-server
ysk-server help
```
