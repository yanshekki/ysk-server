/**
 * ysk-server update — self-update check / plan.
 */

import { planSelfUpdate } from '@ysk/core';
import { PRODUCT_NAME, type StructuredResult } from '@ysk/shared';
import { VERSION } from '../version.js';

export function runUpdate(opts: {
  checkOnly?: boolean;
  latest?: string;
}): StructuredResult<ReturnType<typeof planSelfUpdate>> {
  const latest = opts.latest ?? process.env.YSK_LATEST_VERSION ?? VERSION;
  const plan = planSelfUpdate({
    current: VERSION,
    latest,
  });

  if (opts.checkOnly || !plan.status.updateAvailable) {
    return {
      ok: true,
      code: plan.status.updateAvailable ? 'YSK_UPDATE_AVAILABLE' : 'YSK_UP_TO_DATE',
      message: plan.status.updateAvailable
        ? `${PRODUCT_NAME} update available: ${VERSION} -> ${latest}`
        : `${PRODUCT_NAME} is up to date (${VERSION})`,
      data: plan,
    };
  }

  // Full apply requires network + package privileges; report plan for orchestration
  return {
    ok: true,
    code: 'YSK_UPDATE_PLANNED',
    message: `${PRODUCT_NAME} self-update planned (apply via package manager / install.sh --upgrade)`,
    data: plan,
  };
}
