# install.sh 安全與完整性審查（2026-08-09）

語言：中文 | [English](./install-audit.md)

## 高優先發現與狀態

| ID | 發現 | 狀態 |
|----|------|------|
| I-01 | 遠端 `curl` 安裝庫無 pin | **緩解** — 拒絕非 HTTPS；文件建議 commit SHA |
| I-02 | setup 失敗被吞掉 | **已修** — 無 `config.json` 即 hard fail |
| I-03 | 安裝無 TLS／預設 HTTP | **已修** — `ssl bootstrap` + 僅 HTTPS |
| I-04 | `listenHost` 127.0.0.1 無法 IP 登入 | **已修** — setup `--host 0.0.0.0` |
| I-05 | 私鑰權限 | **已修** — `ssl/panel` 700、key 600 |
| I-06 | `npm @latest` 未鎖定 | **緩解** — `YSK_NPM_VERSION` + 記錄版本 |

## 中優先

| ID | 狀態 |
|----|------|
| I-08 | **已修** — sudo wrapper 引號路徑 |
| I-11 | **已修** — 完成提示不再重做 setup 為第一步 |
| I-12 | **已修** — 預設 locale `zh-HK` |

## 殘留

- 舊 HTTP 安裝**唔會**自動升級：請跑 `ysk-server ssl bootstrap --force`
- 專用 `YSK_NPM_USER` 的完整 systemd 生命週期仍為可選

## I-07 npm 安裝路徑（已硬化）

| Env | 作用 |
|-----|------|
| `YSK_NPM_PREFIX` | 全域套件裝到此 prefix |
| `YSK_NPM_USER` | root 時優先用該用戶 `~/.npm-global` |
| 非 root 預設 | `$HOME/.npm-global` |
| root 且無 env | **警告**後用系統 global |

## 遠端 bootstrap 校驗和

倉庫提供 `install/checksums.sha256`。遠端下載後若取得該檔會 **fail closed** 校驗；`YSK_INSTALL_REQUIRE_CHECKSUMS=1` 可強制必須校驗。

## 操作員路徑

```bash
ysk-server ssl bootstrap --data-dir /var/lib/ysk-server
ysk-server serve --data-dir /var/lib/ysk-server --port 9287
# https://<IP>:9287 — 接受自簽警告
```
