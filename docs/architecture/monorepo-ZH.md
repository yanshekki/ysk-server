# Monorepo 結構

> 語言：中文 | [English](./monorepo.md)

```
ysk-server/
  apps/
    server/     # ysk-server — HTTP API、CLI
    web/        # ysk-server-web — React 面板
  packages/
    shared/     # ysk-server-shared — DTO、ops、錯誤、語言包
    core/       # ysk-server-core — 領域邏輯 + 主機適配
  docs/         # 本文件樹
  scripts/      # 閘門、i18n、e2e
```

| 套件 | 角色 | 依賴 |
|------|------|------|
| `ysk-server-shared` | 型別 + i18n | （無內部依賴） |
| `ysk-server-core` | 業務邏輯 | shared |
| `ysk-server` | 執行二進位 | core, shared |
| `ysk-server-web` | 靜態 UI | shared（型別／語言包） |

## Core 目錄（概覽）

| `packages/core/src` | 域 |
|---------------------|-----|
| `hosting/` | 專案、nginx、ssl、dns、db、防護、備份… |
| `email/` | 域名、信箱、可送達性、暖機 |
| `security/` | allowlist、totp、api-keys、ssh、rbac |
| `files/` | 沙箱檔案管理 |
| `host/` | executor、指標、健康 |
| `db/` | document store 後端 |
| `services/` | auth、users-admin、scheduler |
| `agents/` | fleet session、外送 agent |
| `skills/` | 工具規劃、playbook |

## Server 目錄

| 路徑 | 角色 |
|------|------|
| `cli.ts` | 全部 CLI 命令 |
| `routes/` | HTTP 領域處理 |
| `app-context.ts` | 接線 db + 服務 |
| `cli/setup.ts` | 首次初始化 |

## 建置

```bash
pnpm install
pnpm -r build
pnpm gates
```
