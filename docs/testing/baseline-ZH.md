# 覆蓋率基線

> 語言：中文 | [English](./baseline.md)

全 monorepo 90% 計劃開始時量度（大量補測前）。

| Package | Lines（約） | 備註 |
|---------|-------------|------|
| `@ysk/shared` | **95% lines / 91% funcs**（runtime；types-only 已排除） | Phase 1 — **已鎖 90%** |
| `@ysk/core` | 約 57.6% lines、76.7% functions（先前量度） | Phase 2 — floor 0 直至達標 |
| `@ysk/server` | 路由近 0% | Phase 3 |
| `@ysk/web` | 約 1 個測試檔 | Phase 4 |

重新量度：

```bash
COVERAGE_FLOOR=0 pnpm test:coverage
pnpm test:coverage:report
```
