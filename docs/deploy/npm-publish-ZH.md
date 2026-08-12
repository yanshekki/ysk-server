# npm 發布

> 語言：中文 | [English](./npm-publish.md)

## 公開套件

| 套件 | 用途 | 安裝 |
|------|------|------|
| **`ysk-server`** | 控制面 API + CLI `ysk-server` | `npm install -g ysk-server` |

產品頁：**https://www.npmjs.com/package/ysk-server**

內部的 `@yanshekki/shared` / `@yanshekki/core` 會 **bundle 進** tarball，用戶只需裝 unscoped 名稱。

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

請用 **≥ 1.0.2**。Token 若曾貼喺聊天，請到 npmjs **revoke** 後重建。
