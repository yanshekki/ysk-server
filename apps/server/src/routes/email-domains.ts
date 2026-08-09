/**
 * Email domains dispatcher (Wave P3).
 * crud → ops
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleEmailDomainsCrudRoutes } from './email-domains-crud.js';
import { handleEmailDomainsOpsRoutes } from './email-domains-ops.js';

export async function handleEmailDomainsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleEmailDomainsCrudRoutes(ctx, req, res, url, method)) return true;
  if (await handleEmailDomainsOpsRoutes(ctx, req, res, url, method)) return true;
  return false;
}
