# 控制平面狀態庫

> 語言：中文 | [English](./state-store.md)

控制平面狀態（用戶、專案、設定、session、api_keys…）採用 **document store**：整份快照持久化，**不是**每表完整 relational schema。

## 後端

| 種類 | 何時 | 說明 |
|------|------|------|
| **json** | 預設 | `dataDir/ysk.json`，atomic rename |
| **sqlite** | `YSK_STORE=sqlite` 或路徑 `.sqlite` | sql.js 子進程；另有 JSON mirror |
| **postgres** | `YSK_STORE=postgres` + URL | 實驗性 document blob；需 `pg` |

## CLI

```bash
ysk-server store status --json
ysk-server store export --out snapshot.json
ysk-server store import --in snapshot.json
ysk-server store migrate --to sqlite --out /var/lib/ysk/ysk.sqlite
```

## 誠實邊界

- Document 模式 ≠ ORM／每表 SQL。  
- JSON／SQLite 多進程寫入不安全；保持單 writer。  
- 遷移前先 `store export`。  
