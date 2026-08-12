# 測試

> 語言：中文 | [English](./README.md)

## 目標

| 目標 | 規則 |
|------|------|
| 覆蓋率 | **每個 package** lines + functions + statements **≥ 90%**（`@ysk-server/shared` 已鎖定；core／server／web 隨測試補上提高 floor） |
| Export | 每個 runtime export 須有測試引用，或登記於 [coverage-exceptions.json](./coverage-exceptions.json) |
| 誠實 | 測試必須能抓假成功（`ok && blocked`、`applied` 但無主機成功） |
| Web | Vitest + React Testing Library + happy-dom；只 mock `fetch` fixture — **不可** mock 掉誠實層 |

## 指令

```bash
pnpm test
pnpm test:coverage
pnpm test:coverage:report
pnpm test:exports
pnpm test:exports:strict
```

單 package：

```bash
pnpm --filter @ysk-server/shared test:coverage
COVERAGE_FLOOR=90 pnpm --filter @ysk-server/shared test:coverage
COVERAGE_FLOOR=0  pnpm --filter @ysk-server/core test:coverage
```

## 誠實教條

1. 主機路徑優先真 `mkdtemp` + `LocalHostExecutor`。  
2. 斷言 `ok`、`apply_status`、`requiresExecute`、`blocked`、`notes`，唔好只驗 HTTP 200。  
3. 斷言結構／錯誤碼，唔綁死單一語言字串。  
4. 無 EXECUTE／缺 binary 唔可以報 `applied`。  
5. 禁止空測試。  

Server harness：`apps/server/src/test/harness.ts`  
Core host：`packages/core/src/test/host.ts`  
Web setup：`apps/web/src/test/setup.ts`

## 例外

見 [coverage-exceptions.json](./coverage-exceptions.json)。

## 基線

見 [baseline.md](./baseline.md)。
