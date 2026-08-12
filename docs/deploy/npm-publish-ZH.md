# npm 發布

> 語言：中文 | [English](./npm-publish.md)

將 monorepo 公開套件發到 [npmjs.com](https://www.npmjs.com/)：

| 套件 | 用途 | 安裝 |
|------|------|------|
| `@ysk/shared` | 型別 / locales | 依賴 |
| `@ysk/core` | 託管 / 安全邏輯 | 依賴 |
| `@ysk/server` | 控制面 API + **CLI bin `ysk-server`** | `npm install -g @ysk/server` |

`@ysk/web` 保持 private（打包時 SPA 會嵌進 `@ysk/server` 的 `public/web`）。

## 前置條件

1. **npm 帳號**（建議開 2FA）。
2. **擁有 `@ysk` scope** — 首次需建立免費 org：
   - 瀏覽器：https://www.npmjs.com/org/create → 名稱 `ysk` → 公開套件
3. **Automation token**（無頭機 / CI 建議）：
   - https://www.npmjs.com/settings/~/tokens → **Generate New Token** → **Automation**
   - 寫入 `~/.npmrc`：

```ini
//registry.npmjs.org/:_authToken=npm_XXXXXXXX
```

4. 驗證：

```bash
npm whoami
```

5. Node ≥ 20、pnpm 9+。

## 一鍵流程

只建置／測試／pack（不上傳）：

```bash
bash scripts/prepare-release.sh
```

正式發布：

```bash
bash scripts/prepare-release.sh --publish
```

固定順序：**shared → core → server**。

## 手動發布

```bash
pnpm install --frozen-lockfile
pnpm gates
pnpm typecheck
pnpm build

mkdir -p apps/server/public/web
rm -rf apps/server/public/web/*
cp -a apps/web/dist/. apps/server/public/web/

pnpm --filter @ysk/shared publish --access public
pnpm --filter @ysk/core publish --access public
pnpm --filter @ysk/server publish --access public
```

pnpm 會在 publish 時把 `workspace:*` 改寫成實際版本。

## 發布後驗證

```bash
npm view @ysk/server version
npm install -g @ysk/server
ysk-server --help
```

產品安裝腳本使用 `PKG=@ysk/server`（命令列名稱仍是 `ysk-server`）。

## 版本

同步 bump 要發布的套件 version（目前皆 `1.0.0`）：

- `packages/shared/package.json`
- `packages/core/package.json`
- `apps/server/package.json`

根目錄 `package.json` 為 **private**，不會發布。

## 常見問題

| 現象 | 處理 |
|------|------|
| `npm whoami` → 401 | token 過期，重新產生並寫入 `~/.npmrc` |
| 無 `@ysk/*` 權限 | 建立 org `ysk` 並把帳號設為 owner |
| 2FA 擋 publish | 使用 **Automation** token |
| pack 沒有面板 | 先有 `apps/web/dist` 再 embed |
| 安裝時 native 編譯失敗 | 主機裝 `python3` / `make` / `g++` |

純 git 自架部署不一定需要 npm 發布。
