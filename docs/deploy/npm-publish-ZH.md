# npm 發布

> 語言：中文 | [English](./npm-publish.md)

## 公開套件

| 套件 | 用途 |
|------|------|
| **ysk-server** | 產品 CLI + API + 面板 |
| **ysk-server-shared** | 型別 / locales |
| **ysk-server-core** | 託管 / 安全核心 |

```bash
npm install -g ysk-server
bash scripts/publish-ysk-server-npm.sh --publish
```

> 說明：registry **唔用** `@ysk-server/*` scope（要 org）；公開名係 unscoped 嘅 `ysk-server-*`。
