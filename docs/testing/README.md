# Testing

> Language: English | [中文](./README-ZH.md)

## Goals

| Goal | Rule |
|------|------|
| Coverage | **Each package** ≥ **90%** lines + functions + statements (`ysk-server-shared` locked; core/server/web floor rises as tests land) |
| Exports | Every runtime export has a test reference, or an entry in [coverage-exceptions.json](./coverage-exceptions.json) |
| Honesty | Tests must catch fake success (`ok && blocked`, `applied` without host success) |
| Web | Vitest + React Testing Library + happy-dom; mock `fetch` fixtures only — never mock away honesty |

## Commands

```bash
pnpm test                 # all packages unit tests
pnpm test:coverage        # coverage + package thresholds
pnpm test:coverage:report # aggregate table → coverage/aggregate.json
pnpm test:exports         # export ↔ test scan (report)
pnpm test:exports:strict  # fail on unexplained exports
```

Per package:

```bash
pnpm --filter ysk-server-shared test:coverage
COVERAGE_FLOOR=90 pnpm --filter ysk-server-shared test:coverage
COVERAGE_FLOOR=0  pnpm --filter ysk-server-core test:coverage   # baseline while climbing
```

## Honesty doctrine

1. Prefer real `mkdtemp` + `LocalHostExecutor` over mocks for host paths.  
2. Assert `ok`, `apply_status`, `requiresExecute`, `blocked`, `notes` — not only HTTP 200.  
3. Locale-agnostic assertions (structure / codes), not a single language string.  
4. Fail-closed: no EXECUTE / missing binary must not report `applied`.  
5. No empty tests (`expect(true)`).  

Server harness: `apps/server/src/test/harness.ts`  
Core host helper: `packages/core/src/test/host.ts`  
Web setup: `apps/web/src/test/setup.ts`

## Exceptions

See [coverage-exceptions.json](./coverage-exceptions.json). Allowed reasons: `types-only`, `re-export`, `generated`, `platform-entry`, `cli-thin-delegate`.

## Baseline

See [baseline.md](./baseline.md) for measured numbers at the start of the 90% program.
