# 覆蓋率基線

> 語言：中文 | [English](./baseline.md)

全 monorepo 90% 計劃開始時量度（大量補測前）。

| Package | Lines（約） | 備註 |
|---------|-------------|------|
| `@ysk/shared` | **95% lines / 91% funcs**（runtime；types-only 已排除） | Phase 1 — **已鎖 90%** |
| `@ysk/core` | **90.0% lines / 97.3% funcs**（已鎖） | Phase 2 — **已鎖 90%** |
| `@ysk/server` | **90.0% lines / 約 72% funcs**（lines 已鎖；funcs floor 70） | Phase 3 — **lines 已鎖 90%** |
| `@ysk/web` | **約 7.5% lines / 32% funcs**（RTL + page smoke） | Phase 4 |

重新量度：

```bash
COVERAGE_FLOOR=0 pnpm test:coverage
pnpm test:coverage:report
```
