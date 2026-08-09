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

- root 全域 `npm -g`（I-07）— 日後可改專用用戶
- 遠端資產 checksum 尚未發佈
- 舊 HTTP 安裝**唔會**自動升級：請跑 `ysk-server ssl bootstrap --force`

## 操作員路徑

```bash
ysk-server ssl bootstrap --data-dir /var/lib/ysk-server
ysk-server serve --data-dir /var/lib/ysk-server --port 9287
# https://<IP>:9287 — 接受自簽警告
```
