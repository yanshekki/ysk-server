# 執行環境調校

> 語言：中文（香港書面語）| [English](./runtime-tuning.md)

## 用途

說明面板管理的 Node／PHP／Python／Go／Rust 調校項（執行緒池、記憶體提示、php.ini 目錄等）。

實際安裝仍見 [../features/runtimes-ZH.md](../features/runtimes-ZH.md)。

```bash
ysk-server hosting runtimes --json
```

## 誠實邊界

dataDir 內調校檔要影響線上行程／pool，仍需 EXECUTE。
