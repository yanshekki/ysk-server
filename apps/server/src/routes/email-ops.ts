/**
 * Email ops dispatcher (Wave AC1).
 * stack → dnsbl
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleEmailOpsStackRoutes } from './email-ops-stack.js';
import { handleEmailOpsDnsblRoutes } from './email-ops-dnsbl.js';

export async function handleEmailOpsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleEmailOpsStackRoutes(ctx, req, res, url, method)) return true;
  if (await handleEmailOpsDnsblRoutes(ctx, req, res, url, method)) return true;
  return false;
}
