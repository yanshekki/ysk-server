# 上線清單

> 語言：中文 | [English](./go-live.md)

1. 強管理員密碼 + 2FA  
2. 監聽 loopback 或對外加防火牆  
3. 僅在可信主機開 `YSK_EXECUTE=1`  
4. 安裝 systemd unit（root）  
5. `ysk-server readiness --json` → productionReady  
6. 已安裝備份排程  
7. 郵件：理解外部 PTR／DNS／Port25  

詳見：[../deploy/root-execute-ZH.md](../deploy/root-execute-ZH.md) · [readiness-ZH.md](./readiness-ZH.md)
