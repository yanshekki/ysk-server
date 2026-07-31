# 全站 Form UX + 操作員文案

## Form Kit：主要頁面 ✅

見先前各輪；`SettingField` 頁面已無使用。

## 操作員訊息中文化

### Web 層
- `humanizeOperatorNote` / `humanizeOperatorMessage`
- `useFeatureAction`、`OpsResultPanel`、`ExecutionResultPanel`

### Core（本輪高影響）
| 模組 | 變更 |
|------|------|
| RBAC / Allowlist | 拒絕原因、工具說明繁中 |
| production-readiness | 就緒檢查 title／detail／fixHint |
| email dns-records | 記錄說明 + 外部待辦 |
| project-ops | Nginx 寫入／SSL／暫停／PHP spawn |
| extras / php-fpm / nginx-sync | plan notes |
| mysql-provision / password-hash | 密碼驗證 |
| package-apply / protection | 封鎖與防護模式 |
| backup-cron / redis-provision / project-logs / dnssec | 操作 notes |
| email-bootstrap | 中繼步驟說明 |

### 仍可掃（較低優先）
- app-templates、pm2-apply、powerdns-apply、system-apply 技術 notes
- self-update 校驗訊息
- task-planner LLM 英文 prompt（刻意保留給模型）

## 可選後續
1. 手動 visual walkthrough  
2. 上述低優先 core notes 再批  
3. 操作員字串 i18n  
