/**
 * System readiness fix actions (Wave X1).
 * Extracted from system-migrate-host.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@yanshekki/shared';
import {
  hardenDataDirPerms,
  ensureWebUiBuilt,
} from '@yanshekki/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSystemReadinessRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname === '/api/v1/system/readiness/fix') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { action?: string };
    const action = String(data.action ?? '').trim();
    if (!action) {
      sendJson(res, 400, { ok: false, notes: ['action required'] });
      return true;
    }
    if (action === 'harden-datadir') {
      const result = hardenDataDirPerms(ctx.dataDir);
      ctx.audit.append({
        actor: user.username,
        action: 'system.readiness.fix',
        detail: {
          fixAction: action,
          path: result.path,
          before: result.before,
          after: result.after,
          notes: result.notes,
        },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ok: result.ok,
        action,
        path: result.path,
        before: result.before,
        after: result.after,
        notes: result.notes,
      });
      return true;
    }
    if (action === 'build-web-ui') {
      const result = await ensureWebUiBuilt({ dataDir: ctx.dataDir });
      ctx.audit.append({
        actor: user.username,
        action: 'system.readiness.fix',
        detail: {
          fixAction: action,
          path: result.path,
          notes: result.notes,
          codes: result.codes,
        },
        ok: result.ok,
      });
      // Prefer localized operator message when monorepo/package missing
      const notes =
        result.ok || !result.codes?.includes('NO_MONOREPO')
          ? result.notes
          : [
              tl('readiness.itemWebBuildManual'),
              ...result.notes,
            ];
      sendOpsResult(res, {
        ok: result.ok,
        action,
        path: result.path,
        notes,
        codes: result.codes,
      });
      return true;
    }
    sendJson(res, 400, {
      ok: false,
      notes: [`unknown readiness fix action: ${action}`],
      action,
    });
    return true;
  }

  return false;
}
