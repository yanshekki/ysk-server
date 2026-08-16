# 功能：Docker

> 語言：中文 | [English](./docker.md)

## 用途

在這部主機提供一級 **Docker Engine** 控制面：安裝、啟動／停止引擎、管理容器、映像、volume、網絡、Compose 專案、磁碟清理，以及安全的 `daemon.json` 子集。產品地位同 Nginx／Apache 一樣。

驗證者節點（`/validators`）以 `yskval-*` Compose 專案運行；未裝 Docker 時會連嚟呢頁安裝。

**非目標：** Kubernetes、Swarm、任意上載 Compose YAML、`docker build`、`docker exec`、特權執行、Docker Hub 登入。

## 面板

| 項目 | 值 |
|------|--------|
| 路由 | `/docker` |
| 導覽 | `docker`（section `containers`） |
| 分頁 | 概覽 · 容器 · 映像 · Compose · Volume · 網絡 · 清理 · 設定 · 關於 |
| 權限 | `docker.read` · `docker.manage` · `docker.wipe` |
| 安裝 | Ubuntu `docker.io` + `docker-compose-v2`（軟件目錄，不用 get.docker.com） |

## CLI

```bash
ysk-server docker status --json
ysk-server docker ps --json
ysk-server docker images --json
ysk-server docker compose ls --json
YSK_EXECUTE=1 ysk-server docker compose rm --project yskval-eth-hoodi-1 --execute --json
YSK_EXECUTE=1 ysk-server docker run --image alpine:3.20 --name demo --execute --json
YSK_EXECUTE=1 ysk-server docker engine start --execute --json
```

變更預設試行。真正改主機需要 `YSK_EXECUTE=1` 同 `--execute`。

## 安全

- 發佈埠預設 `127.0.0.1`
- 禁止 `--privileged`、host 網絡、掛載 `/` `/etc` `/root`
- 清理 volume／系統需要 `confirm=PRUNE` 同 `docker.wipe`
- 停止 `docker.service` 會停晒所有容器，包括驗證者堆疊
