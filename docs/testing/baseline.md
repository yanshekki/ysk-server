# Coverage baseline

## Locked floors (post climb, 2026-08-02)

All packages meet **lines/statements/functions ≥90%** and **branches ≥80%** on exclusive Vitest+v8 runs.

| Package | Lines | Functions | Branches | Notes |
|---------|-------|-----------|----------|-------|
| `@ysk/shared` | ~99.2% | **100%** | ~97.5% | floors 90 / 90 / 75 |
| `@ysk/core` | ~91.4% | ~97.6% | ~80.1% | floors 90 / 90 / 80 |
| `@ysk/server` | ~91.1% | ~94.5% | ~80.2% | floors 90 / 90 / 75 |
| `@ysk/web` | ~93.8% | ~91.0% | ~85.7% | floors 90 / 90 / 85 |

Web functions climbed ~85%→≥90% via pure helpers + `bind-handlers` factories. Residual hotspots listed in `coverage-exceptions.json` → `residualNotes` (not excluded from measurement).

See also implementer scratch `coverage-final.txt` for per-file miss lists.


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
