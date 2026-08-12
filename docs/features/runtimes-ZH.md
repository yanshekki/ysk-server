# 執行環境（Runtimes）

> 語言：中文（香港書面語）| [English](./runtimes.md)

## 用途

在主機上探測、安裝、切換與解除安裝 **應用執行環境**：Node、PHP、Python、Go、Rust、**Java**、**Kotlin**、**Bun**，支援多版本與可選外掛／擴充。

**非目標：**「工具鏈已安裝」並不代表專案已上線（仍需部署與邊緣發佈）。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/runtimes/node`、`/php`、`/python`、`/go`、`/rust`、`/java`、`/kotlin`、`/bun` |
| 導航鍵 | `node`、`php`、`python`、`go`、`rust`、`java`、`kotlin`、`bun` |
| 主要操作 | 探測 · 安裝 · 切換預設 · 解除安裝 · 外掛／PHP 擴充 |
| 能力 | 託管 runtime |
| RBAC | 託管操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 探測／列表 | `ysk-server runtimes list --json` | read | 亦可用 `hosting runtimes` |
| 安裝／計劃 | `ysk-server runtimes install --kind K --version V [--execute]` | write-host | 無 execute 為計劃 |
| 切換預設 | `ysk-server runtimes switch --kind K --version V --execute` | write-host | |
| 解除安裝版本 | `ysk-server runtimes uninstall --kind K --version V --execute` | write-host | |
| hosting 別名 | `ysk-server hosting runtime-install\|runtime-switch\|runtime-uninstall` | write-host | 同一核心 |

引擎：`node` · `php` · `python` · `go` · `rust` · `java` · `kotlin` · `bun`。

## CLI 速查

```bash
ysk-server runtimes list --json
ysk-server runtimes install --kind java --version 21 --json
export YSK_EXECUTE=1
ysk-server runtimes install --kind java --version 21 --execute --json
ysk-server runtimes switch --kind node --version 20 --execute --json
```

完整 argv：[../cli/reference-ZH.md](../cli/reference-ZH.md#runtimes)。

## 誠實邊界

- 無 EXECUTE 時，真實套件安裝會被阻擋。  
- 切換／解除安裝受管版本可能需要 root。  
- 工具鏈就緒後仍須另行部署專案。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| 安裝過程 SSE 日誌終端 | 互動串流；CLI 輸出最終 JSON |

## 相關

- [專案](./projects-ZH.md)  
- [面板 ↔ CLI 矩陣](../cli/panel-parity-matrix-ZH.md)  
- [CLI 參考 — runtimes](../cli/reference-ZH.md#runtimes)  
