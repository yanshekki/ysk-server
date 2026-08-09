# 二次開發指南（Secondary development）

語言：中文 | [English](./secondary-dev.md)

## 層次（必須遵守）

```
packages/shared  → ErrorCodes, CapabilityId, DTO, list-query, i18n
packages/core    → domain service / apply / HostExecutor
apps/server      → thin HTTP: auth → validate → service → sendOpsResult | sendError
apps/web         → 只用 shared DTO + feature api（不 import core）
```

**唯一工作目錄（本 repo 約定）：** `/home/ki/文件/ysk-server/`

## 新增 HTTP 端點樣板

1. **Capability**：在 `packages/shared/src/capabilities.ts` + `route-capabilities.ts` 登記  
2. **DTO**：`packages/shared/src/<domain>.ts`  
3. **Core 邏輯**：`packages/core/src/...`（真實 apply，禁止 mock 成功）  
4. **Route**：`apps/server/src/routes/<domain>.ts`  

```ts
import { requireUserCap } from '../http/handler.js';
import { readJsonBody, requireString } from '../http/validate.js';
import { sendOpsResult, sendJson } from '../http/util.js';

// 突變 → sendOpsResult；錯誤 → throw YskError
const user = requireUserCap(ctx, req, 'projects.write');
const body = await readJsonBody(req);
const name = requireString(body, 'name', { min: 1, max: 80 });
const r = await someCoreApply({ ... });
sendOpsResult(res, r);
```

## 安全紅線

- 宿主變更：`YSK_EXECUTE` + 誠實 `blocked` / `requiresExecute`  
- 不要 `sendJson(res, r.ok ? 200 : 422, r)`（用 `sendOpsResult`）  
- Fleet/edge：agent token；不要公開 register  
- Tools `fs.*`：必須在 dataDir / fsRoots 沙箱內  

## 現有 helper

| Helper | 路徑 |
|--------|------|
| `readJsonBody` / `requireString` / `requireEnum` | `apps/server/src/http/validate.ts` |
| `requireUser` / `requireUserCap` | `apps/server/src/http/handler.ts` |
| `sendOpsResult` / `sendError` | `apps/server/src/http/util.ts` |
| `listWithQuery` | `apps/server/src/http/list-response.ts` |
| `honestyFromFlags` | `@ysk/core` (`apply-honesty`) |
| `assertSafeOutboundUrl` | `@ysk/core` (`net/ssrf`) |

## 用戶 / 套餐路由

在 **`routes/admin.ts`**（已從 misc 抽出），勿再往 `misc.ts` 塞 users/packages 突變。
