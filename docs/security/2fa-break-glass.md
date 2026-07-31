# 2FA break-glass（Panel / SSH）

> Language: English | [中文](./2fa-break-glass-ZH.md)

## Panel 操作員丟了 Authenticator

1. 用 **recovery codes**（啟用 2FA 時一次顯示、只存 hash）登入：登入表單填 `recoveryCode`。
2. 登入後立即重新設定 2FA（begin → confirm → 保存新 recovery）。
3. 若 recovery 也沒有：需要主機管理員在 `dataDir` 用戶資料中清掉 `totp_*` 欄位（停機／維護窗），並審計。

## SSH 用戶丟了 Authenticator

1. 用 **scratch codes**（寫入 `~/.google_authenticator` 時一次顯示）在 SSH 提示輸入。
2. 或在 panel **安全 → SSH → 登入 2FA** 退役並重新登記（需 panel 登入）。
3. 救援：至少保留一名 **沒有** `.google_authenticator` 的 console/admin（PAM `nullok`）。

## 加固能力（YSK）

| 能力 | 說明 |
|------|------|
| Login rate limit | 5 次／15 分失敗 → 鎖 15 分（IP+username） |
| TOTP 加密 | `yskenc:v1:` AES-GCM（dataDir master key） |
| Anti-replay | 同 time-step 不可重用 |
| Recovery codes | Panel 登入可用；hash 存儲 |
| Step-up | export 私鑰、建 API key、strict apply、fromPanel |
| beginTotp | 需再輸入密碼 |
| Sessions | 閒置 4h／絕對 24h；可 list／撤銷 |
| requireAdminTotp | 設定 `security.require_admin_totp`；strict 拒未開 2FA 的 admin |
| SSH health | package / PAM / kbd 三燈 |
| SSH strict Match | 每用戶 publickey+TOTP、關 password；排除救援用戶 |

**Panel 與 SSH 預設 secret 分開。** 見 [2fa-panel-vs-ssh.md](./2fa-panel-vs-ssh.md)。

### 關 strict admin 政策（locked out）

在 dataDir 的 store 中設定：

```json
"settings": {
  "security.require_admin_totp": "0",
  "security.require_admin_totp_strict": "0"
}
```
