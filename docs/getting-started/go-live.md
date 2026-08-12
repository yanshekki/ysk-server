# Go-live checklist

> Language: English | [中文](./go-live-ZH.md)

1. Strong admin password + 2FA  
2. Listen on loopback or firewall public bind  
3. `YSK_EXECUTE=1` only on trusted hosts  
4. systemd: root `install.sh` enables/starts `ysk-server` by default — verify `systemctl is-active ysk-server`  
5. `ysk-server readiness --json` → productionReady  

6. Backup schedule installed  
7. Mail: external PTR/DNS/Port25 understood  

Details: [../deploy/root-execute.md](../deploy/root-execute.md) · [readiness.md](./readiness.md)
