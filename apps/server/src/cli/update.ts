/**
 * ysk-server update — check npm registry + optional apply.
 */

import { planSelfUpdate, runSelfUpdate, LocalHostExecutor } from '@ysk-server/core';
import { PRODUCT_NAME, type StructuredResult, tl} from '@ysk-server/shared';
import { VERSION } from '../version.js';

export async function runUpdate(opts: {
  checkOnly?: boolean;
  latest?: string;
  apply?: boolean;
}): Promise<StructuredResult<unknown>> {
  const host = new LocalHostExecutor({
    executeEnabled: process.env.YSK_EXECUTE === '1' || process.env.YSK_EXECUTE === 'true',
  });

  try {
    const result = await runSelfUpdate({
      currentVersion: VERSION,
      host,
      apply: Boolean(opts.apply) && !opts.checkOnly,
      latestOverride: opts.latest,
    });

    if (opts.checkOnly || !result.plan.status.updateAvailable) {
      return {
        ok: true,
        code: result.plan.status.updateAvailable ? 'YSK_UPDATE_AVAILABLE' : 'YSK_UP_TO_DATE',
        message: result.plan.status.updateAvailable
          ? `${PRODUCT_NAME} update available: ${VERSION} -> ${result.plan.status.latestVersion}`
          : `${PRODUCT_NAME} is up to date (${VERSION})`,
        data: result,
      };
    }

    if (opts.apply) {
      return {
        ok: result.applied,
        code: result.applied ? 'YSK_UPDATE_APPLIED' : 'YSK_UPDATE_APPLY_FAILED',
        message: result.applied
          ? `${PRODUCT_NAME} updated via npm`
          : `${PRODUCT_NAME} apply failed or skipped — ${result.notes.join('; ')}`,
        data: result,
      };
    }

    return {
      ok: true,
      code: 'YSK_UPDATE_PLANNED',
      message: `${PRODUCT_NAME} self-update planned (run with --apply and YSK_EXECUTE=1)`,
      data: result,
    };
  } catch (e) {
    // Honest fail — do not invent "up to date" from missing channel
    const plan = planSelfUpdate({
      current: VERSION,
      latest: opts.latest ?? VERSION,
    });
    return {
      ok: false,
      code: 'YSK_UPDATE_CHECK_FAILED',
      message: e instanceof Error ? e.message : String(e),
      data: {
        plan,
        notes: [
          e instanceof Error ? e.message : String(e),
          tl('notes.auto.n0975'),
        ],
      },
    };
  }
}
