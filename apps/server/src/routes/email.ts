/**
 * Email routes dispatcher (Wave I3).
 * domains → webmail → ops
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleEmailDomainsRoutes } from './email-domains.js';
import { handleEmailWebmailRoutes } from './email-webmail.js';
import { handleEmailOpsRoutes } from './email-ops.js';

export async function handleEmailRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleEmailDomainsRoutes(ctx, req, res, url, method)) return true;
  if (await handleEmailWebmailRoutes(ctx, req, res, url, method)) return true;
  if (await handleEmailOpsRoutes(ctx, req, res, url, method)) return true;
  return false;
}
