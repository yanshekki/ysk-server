# Coverage baseline

> Language: English | [中文](./baseline-ZH.md)

Measured at start of the monorepo 90% program (before mass test fill).

| Package | Lines (approx) | Notes |
|---------|----------------|-------|
| `@ysk/shared` | **95.0% lines / 91.1% funcs** | Phase 1 — **locked 90%** |
| `@ysk/core` | **90.1% lines / 97.3% funcs** | Phase 2 — **locked 90%** |
| `@ysk/server` | **90.0% lines / 71.8% funcs** (funcs floor 70 until CLI split) | Phase 3 — **lines locked 90%** |
| `@ysk/web` | **90.4% lines / 73.2% funcs** (funcs floor 70) | Phase 4 — **lines locked 90%** |

Regenerate:

```bash
COVERAGE_FLOOR=0 pnpm test:coverage
pnpm test:coverage:report
```
