# Coverage baseline

> Language: English | [中文](./baseline-ZH.md)

Measured at start of the monorepo 90% program (before mass test fill).

| Package | Lines (approx) | Notes |
|---------|----------------|-------|
| `@ysk/shared` | **95% lines / 91% funcs** (runtime; types-only excluded) | Phase 1 — **locked 90%** |
| `@ysk/core` | **~66% lines / ~84% funcs** (climbing from 58% / 77%) | Phase 2 — floor 0 until 90% |
| `@ysk/server` | **~16% lines / ~45% funcs** (HTTP harness + route batch started) | Phase 3 |
| `@ysk/web` | **~7.5% lines / ~32% funcs** (RTL + page smokes started) | Phase 4 |

Regenerate:

```bash
COVERAGE_FLOOR=0 pnpm test:coverage
pnpm test:coverage:report
```
