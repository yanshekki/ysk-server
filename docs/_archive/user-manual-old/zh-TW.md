# YSK Server 使用手冊（繁體中文）

## 安裝

```bash
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash
ysk-server setup
ysk-server serve
```

## 登入 Web UI

預設開發帳號（請於正式環境立即修改）：`admin` / `admin`。

介面語言：繁中（預設）、English、简体中文。

## 常用功能

1. **儀表板** — 健康狀態與保護模式
2. **專案** — 每個網站獨立 Linux 用戶
3. **安全** — Allowlist、審批、RBAC
4. **郵件** — 一鍵郵件伺服器與外部待辦
5. **更新** — 智能更新與漏洞建議
6. **AI Agent** — OpenClaw / Hermes / IonClaw

## CLI 快速參考

```bash
ysk-server --help
ysk-server tools --json
ysk-server update --check
```
