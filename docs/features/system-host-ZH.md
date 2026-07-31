# 系統與主機

> 語言：中文（香港書面語）| [English](./system-host.md)

**面板路由：** `/system`、`/services`、`/updates`、就緒  
**CLI：** `system`、`services`、`update`、`readiness`、`doctor`、`host`

## 控制平面 unit

```bash
ysk-server system unit-install --enable --execute
```

## 服務矩陣

探測 systemctl unit（nginx、db、郵件、fail2ban…）。

```bash
ysk-server services --json
```

## 更新

套件庫存／建議／套用計劃（真實 apt 需 EXECUTE）。

```bash
ysk-server update --check --json
ysk-server update --apply --execute --json
```

## 就緒

```bash
ysk-server readiness --json
ysk-server doctor --json
```

解讀：`productionReady`、每項 `level`（ready／degraded／missing）、`fixHint`。未達標時 HTTP 可 503，但仍回完整報告。

## 相關

[../getting-started/readiness-ZH.md](../getting-started/readiness-ZH.md) · [logs-metrics-ZH.md](./logs-metrics-ZH.md)
