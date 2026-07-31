# 執行環境

> 語言：中文（香港書面語）| [English](./runtimes.md)

**面板路由：** `/runtimes/node`、`/runtimes/php`…  
**CLI：** `hosting runtimes`、`hosting runtime-install`

## 功能

探測已安裝工具鏈並產出**安裝計劃**。支援多版本感知（如 Node 18／20／22、PHP 8.x）。

| Runtime | 典型探測 |
|---------|----------|
| Node | `node`、npm／pnpm、可選 PM2 |
| PHP | `php`、FPM pool |
| Python／Go／Rust | 語言二進位／cargo |

## CLI

```bash
ysk-server hosting runtimes --json
ysk-server hosting runtime-install --kind node --version 20 --json
ysk-server hosting runtime-install --kind php --version 8.3 --install --execute
```

## 流程

1. 探測 PATH 上已有工具。  
2. 覆核計劃（套件、命令）。  
3. 僅在 EXECUTE 下 `--execute`（apt 常需 root）。  
4. 再探測；然後以該 runtime 部署專案。  

## 誠實邊界

無 EXECUTE 時安裝會 blocked。「工具鏈已裝」≠「專案已上線」（仍需 deploy + 發布 nginx）。

## 相關

[projects-ZH.md](./projects-ZH.md) · [../cli/reference-ZH.md](../cli/reference-ZH.md)
