# 覆蓋率基線

> 語言：中文 | [English](./baseline.md)

全 monorepo 90% 計劃開始時量度（大量補測前）。

| Package | Lines（約） | 備註 |
|---------|-------------|------|
| `@ysk/shared` | **95.0% lines / 91.1% funcs** | Phase 1 — **已鎖 90%** |
| `@ysk/core` | **90.1% lines / 97.3% funcs** | Phase 2 — **已鎖 90%** |
| `@ysk/server` | **90.0% lines / 71.8% funcs**（funcs floor 70 直至 CLI 拆分） | Phase 3 — **lines 已鎖 90%** |
| `@ysk/web` | **90.4% lines / 73.2% funcs**（funcs floor 70） | Phase 4 — **lines 已鎖 90%** |

重新量度：

```bash
COVERAGE_FLOOR=0 pnpm test:coverage
pnpm test:coverage:report
```
