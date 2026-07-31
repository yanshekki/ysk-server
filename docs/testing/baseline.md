# Coverage baseline

> Language: English | [中文](./baseline-ZH.md)

Measured at start of the monorepo 90% program (before mass test fill).

| Package | Lines (approx) | Notes |
|---------|----------------|-------|
| `@ysk/shared` | **95% lines / 91% funcs** (runtime; types-only excluded) | Phase 1 — **locked 90%** |
| `@ysk/core` | ~57.6% lines, ~76.7% functions (prior run) | Phase 2 — floor 0 until climb |
| `@ysk/server` | near 0% routes | Phase 3 |
| `@ysk/web` | ~1 test file | Phase 4 |

Regenerate:

```bash
COVERAGE_FLOOR=0 pnpm test:coverage
pnpm test:coverage:report
```
