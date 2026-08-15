# VPN（伺服器 + 客戶端）

> 語言：中文（香港書面語）| [English](./vpn.md)

## 用途

在控制平面主機管理 **開源 VPN**：

- **伺服器** — 接受 WireGuard／OpenVPN／Shadowsocks 客戶端  
- **客戶端** — 本機匯入設定檔 **連出**  

**非目標：** 多租戶 VPN SaaS；完整商業 Outline Manager。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/vpn` |
| 導航鍵 | `vpn` |
| 主要分頁 | 安裝 · 伺服器 · 客戶端 · 監控 |
| 能力 | `network.vpn` |
| RBAC | 具備 VPN 網絡能力之操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 總覽／引擎狀態 | `ysk-server vpn status --json` | read | |
| 即時監控 | `ysk-server vpn monitor [--engine …] --json` | read | |
| 埠預設 | `ysk-server vpn presets --json` | read | |
| 確保／套用伺服器 | `ysk-server vpn ensure --engine … [--port …] --execute --json` | write-host | |
| 停止伺服器 | `ysk-server vpn stop --engine … --execute --json` | write-host | |
| 列出伺服器對等端 | `ysk-server vpn peers list --engine … --json` | read | |
| 新增對等端 | `ysk-server vpn peers add --name NAME --execute --json` | write-host | |
| 刪除對等端 | `ysk-server vpn peers delete --id ID --execute --json` | write-host | |
| 匯出對等端設定 | `ysk-server vpn peers config --id ID` | read | 面板可 QR／下載 |
| 列出客戶端設定檔 | `ysk-server vpn clients list --json` | read | |
| 匯入客戶端 conf | `ysk-server vpn clients import --name N --file PATH --json` | write-panel | |
| 客戶端上線／下線 | `ysk-server vpn clients up\|down --id ID --execute --json` | write-host | |
| 刪除客戶端設定檔 | `ysk-server vpn clients delete --id ID --execute --json` | write-host | |
| 開啟防火牆埠 | `ysk-server vpn firewall open --port N --execute --json` | write-host | 經服務暴露 |

## CLI 速查

```bash
ysk-server vpn status --json
ysk-server vpn peers list --engine wireguard --json
export YSK_EXECUTE=1
ysk-server vpn ensure --engine wireguard --port 51820 --execute --json
ysk-server vpn stop --engine wireguard --execute --json
ysk-server vpn peers add --name phone --execute --json
ysk-server vpn peers config --id PEER_ID --out ./peer.conf
```

完整 argv：[../cli/reference-ZH.md](../cli/reference-ZH.md#vpn)。

## 引擎

| 引擎 | 伺服器 | 客戶端 |
|------|--------|--------|
| WireGuard | 完整 | 完整 |
| OpenVPN | 完整（PKI、`.ovpn`） | 完整 |
| Shadowsocks（`ss-server`） | 金鑰／QR（非完整 Outline Manager） | 有限 |

## 誠實邊界

- 無 `YSK_EXECUTE` + root 時，安裝／ensure／對等端變更維持 **已阻擋** 或試跑。  
- 該引擎（WireGuard／OpenVPN／Outline）未安裝時，「套用伺服器」停用。服務卡連到對應 `?tab=`。  
- QR 中的公開 **端點** 須與防火牆及真實公網位址一致。  
- 全隧道客戶端 conf 可能注入策略路由，以保持面板／SSH 可達。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| QR 繪製畫布 | 僅顯示；設定可經 CLI 匯出 |

## 相關

- [面板 ↔ CLI 矩陣](../cli/panel-parity-matrix-ZH.md)  
- [CLI 參考 — vpn](../cli/reference-ZH.md#vpn)  
- [VNC](./vnc-ZH.md) — 常於隧道建立後使用  
- [運維誠實](../architecture/ops-honesty-ZH.md)  
