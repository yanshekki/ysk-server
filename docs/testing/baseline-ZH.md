# 覆蓋率基線 + 最終報告

> 語言：中文 | [English](./baseline.md)

量度：2026-08-02，各包獨立 Vitest+v8（`COVERAGE_FLOOR` 作門檻）。

## 套件總覽

| package | lines | statements | functions | branches | gates |
|---------|------:|-----------:|----------:|---------:|-------|
| shared  | 99.16 | 99.16 | 100.00 | 97.47 | L/S/F≥90 B≥80 PASS |
| core    | 91.41 | 91.41 | 97.60 | 80.09 | L/S/F≥90 B≥80 PASS |
| server  | 91.10 | 91.10 | 94.47 | 80.19 | L/S/F≥90 B≥80 PASS |
| web     | 92.95 | 92.95 | 90.11 | 84.29 | L/S/F≥90 B≥84 PASS |

Web branches 門檻為 **84**（殘餘已記錄；monorepo branches 仍 ≥80）。
刪除 theater hammers 後，以 bind-handlers 工廠與 pure-helper dual-path 誠實恢復 Web functions。

## 本波 skeptic 修正

- `humanizeFirewall`：`inactive` 詞界優先於 `active` 子字串
- 刪除 theater hammers（`functions-deep90` / label-hit / max-hit / handler-hit / hammer / deep-userevent / pd-diag）
- 誠實擴充 bind-handlers + residual pure-helper 套件

## 殘餘說明（誠實記錄，非靜默排除）

- Web branches 約 15.7% 殘餘：多為大頁 JSX 條件（Logs / Protection / Cdn / Files / Backups 互動路徑）
- Web functions 約 9.9% 殘餘：命名 handler（`openEdit*`、onConfirm、多 setState 表單）仍需互動測試或繼續 bind 坍縮
- Core branches 約 19.9% 殘餘：大型 host/ops 模組（相對於 80% 門檻可接受）

## Web functions 熱點

- miss=10 (64.3%) `src/pages/ProjectDetailPage.tsx`
- miss=8 (88.4%) `src/pages/FilesPage.tsx`
- miss=7 (88.5%) `src/pages/UsersPage.tsx`
- miss=7 (87.9%) `src/pages/features/BackupsPage.tsx`
- miss=7 (87.0%) `src/pages/features/MetricsPage.tsx`
- miss=7 (68.2%) `src/features/projects/ui/ProjectDeployTab.tsx`
- miss=6 (92.4%) `src/pages/features/ProtectionPage.tsx`
- miss=6 (89.7%) `src/pages/features/NetworkPage.tsx`
- miss=6 (83.3%) `src/pages/features/SqlEnginePage.tsx`
- miss=6 (82.3%) `src/pages/SecurityPage.tsx`
- miss=6 (76.0%) `src/pages/SystemPage.tsx`
- miss=6 (73.9%) `src/pages/features/NginxPage.tsx`

## 重新量度

```bash
COVERAGE_FLOOR=0 pnpm --filter @yanshekki/shared test:coverage
COVERAGE_FLOOR=0 pnpm --filter @yanshekki/core test:coverage
COVERAGE_FLOOR=0 pnpm --filter ysk-server test:coverage
COVERAGE_FLOOR=0 pnpm --filter @yanshekki/web test:coverage
```
