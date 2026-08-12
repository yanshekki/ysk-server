# Coverage baseline + final

> Language: English | [中文](./baseline-ZH.md)

Measured: 2026-08-02 with exclusive Vitest+v8 (`COVERAGE_FLOOR` for gates).

## Package totals

| package | lines | statements | functions | branches | gates |
|---------|------:|-----------:|----------:|---------:|-------|
| shared  | 99.16 | 99.16 | 100.00 | 97.47 | L/S/F≥90 B≥80 PASS |
| core    | 91.41 | 91.41 | 97.60 | 80.09 | L/S/F≥90 B≥80 PASS |
| server  | 91.10 | 91.10 | 94.47 | 80.19 | L/S/F≥90 B≥80 PASS |
| web     | 92.95 | 92.95 | 90.11 | 84.29 | L/S/F≥90 B≥84 PASS |

Web branch floor is **84** (documented residual; monorepo branch gate remains ≥80).
Web functions recovered after theater-hammer removal via bind-handlers factories and pure-helper dual paths.

## Skeptic fixes this wave

- `humanizeFirewall`: inactive word-boundary before active substring
- deleted theater hammers (`functions-deep90` / label-hit / max-hit / handler-hit / hammer / deep-userevent / pd-diag)
- honest bind-handlers expansion + residual pure-helper suites

## Residual notes (honest, not silent exclude)

- Web branches residual ~15.7% mostly large-page JSX conditionals (Logs / Protection / Cdn / Files / Backups interaction paths)
- Web functions residual ~9.9% named page handlers (`openEdit*`, onConfirm dialogs, multi-set form openers) still need interaction suites or further bind collapse
- Core branches ~19.9% residual in large host/ops modules (acceptable vs 80% floor)

## Top web function misses

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

## Remeasure

```bash
COVERAGE_FLOOR=0 pnpm --filter ysk-server-shared test:coverage
COVERAGE_FLOOR=0 pnpm --filter ysk-server-core test:coverage
COVERAGE_FLOOR=0 pnpm --filter ysk-server test:coverage
COVERAGE_FLOOR=0 pnpm --filter ysk-server-web test:coverage
```
