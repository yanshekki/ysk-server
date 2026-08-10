# VPN（伺服器 + 客戶端）

> 語言：繁體中文（香港書面語）| [English](./vpn.md)

## 用途

在控制面主機管理 **開源 VPN**：

- **伺服器** — 本機接受 WireGuard 客戶端（手機、筆電、其他伺服器）
- **客戶端** — 本機匯入 conf **連出**到其他 VPN

## 引擎

| 引擎 | 狀態 |
|------|------|
| WireGuard | 伺服器 + 客戶端完整 |
| OpenVPN | 伺服器 + 客戶端完整（PKI、`.ovpn`） |
| Shadowsocks（`ss-server`） | 伺服器 + `ss://` 金鑰／QR（非完整 Outline Manager） |

## 路由

| 項目 | 值 |
|------|-----|
| UI | `/vpn` |
| API | `/api/v1/vpn/*` |
| 能力 | `network.vpn` |
| 安裝 | 軟件目錄 `wireguard`／`openvpn`（需 `YSK_EXECUTE` + root） |

## 伺服器流程

1. 安裝分頁 → 一鍵 WireGuard  
2. 伺服器分頁 → 監聽埠（預設 **51820/udp**）+ 公開端點  
3. 啟動伺服器 → 開防火牆  
4. 建立客戶端 → **下載金鑰**／**QR Code**

## 客戶端流程

1. 貼上 WireGuard conf → 匯入  
2. 連線／斷線  

## 誠實原則

未開 `YSK_EXECUTE` 時，安裝與伺服器／客戶端連線均 **阻擋**（不建半成品）。
