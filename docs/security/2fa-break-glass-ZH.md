# 2FA 緊急破門

> 語言：中文 | [English](./2fa-break-glass.md)

## 用途

管理員無法使用 TOTP 時的**緊急**破門流程。必須有主機主控台／實體存取。

## 原則

1. 優先用**復原碼**（登記 2FA 時顯示一次）。  
2. 否則以 root 在控制平面 `dataDir` 調整用戶 TOTP 旗標（高風險）。  
3. 破門後立即重新登記 2FA 並審計。  

## 旗標（settings）

| 鍵 | 含義 |
|----|------|
| `security.require_admin_totp` | 要求管理員開啟 2FA |
| `security.require_admin_totp_strict` | 嚴格：未開 2FA 拒登入 |

詳見英文版步驟與警告。CLI：`security status`。

## 誠實邊界

破門能力 = 主機 root 能力。保護 dataDir 檔案權限與備份。
