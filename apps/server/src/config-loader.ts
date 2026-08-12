/**
 * Load setup-written config.json for serve.
 */

import { existsSync, readFileSync } from 'node:fs';
import { parseConfig, type YskConfig } from 'ysk-server-core';
import { ErrorCodes, YskError, tl} from 'ysk-server-shared';

/**
 * Load and parse a YSK config file path produced by `ysk-server setup`.
 */
export function loadConfigFile(configPath: string): YskConfig {
  if (!configPath) {
    throw new YskError(ErrorCodes.CONFIG_INVALID, tl('notes.auto.n1409'), { httpStatus: 400 });
  }
  if (!existsSync(configPath)) {
    throw new YskError(ErrorCodes.CONFIG_INVALID, tl('notes.auto.t0779', { v0: (configPath) }), {
      httpStatus: 400,
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new YskError(ErrorCodes.CONFIG_INVALID, tl('notes.auto.t0780', { v0: (configPath) }), {
      httpStatus: 400,
      cause: err,
    });
  }
  return parseConfig(raw);
}
