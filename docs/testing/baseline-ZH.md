# 覆蓋率基線

> 語言：中文 | [English](./baseline.md)

全 monorepo 90% 計劃開始時量度（大量補測前）。

| Package | Lines（約） | 備註 |
|---------|-------------|------|
| `@ysk/shared` | **95% lines / 91% funcs**（runtime；types-only 已排除） | Phase 1 — **已鎖 90%** |
| `@ysk/core` | **約 66% lines / 84% funcs**（由 58%／77% 爬升） | Phase 2 — floor 0 直至 90% |
| `@ysk/server` | **約 16% lines / 45% funcs**（HTTP harness + 路由批量） | Phase 3 |
| `@ysk/web` | **約 7.5% lines / 32% funcs**（RTL + page smoke） | Phase 4 |

重新量度：

```bash
COVERAGE_FLOOR=0 pnpm test:coverage
pnpm test:coverage:report
```
