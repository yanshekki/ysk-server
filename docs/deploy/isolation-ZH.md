# 專案隔離

> 語言：中文 | [English](./isolation.md)

## 目標

每專案獨立 Linux 用戶 + home，實踐最小權限。

```bash
ysk-server projects isolation list --json
ysk-server projects isolation provision --id UUID --execute
ysk-server projects isolation provision-all --execute
ysk-server projects isolation backfill-owners --json
```

## 誠實邊界

`useradd` 需 root+EXECUTE。未 provision 時仍可能在 dataDir homes 降級運行。

## 相關

[../features/projects-ZH.md](../features/projects-ZH.md) · [project-isolation-ZH.md](./project-isolation-ZH.md)
