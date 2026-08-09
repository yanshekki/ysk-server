/**
 * Email domain ops dispatcher (Wave S2).
 * deliverability → mailboxes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleEmailDomainsDeliverabilityRoutes } from './email-domains-deliverability.js';
import { handleEmailDomainsMailboxesRoutes } from './email-domains-mailboxes.js';

export async function handleEmailDomainsOpsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleEmailDomainsDeliverabilityRoutes(ctx, req, res, url, method)) return true;
  if (await handleEmailDomainsMailboxesRoutes(ctx, req, res, url, method)) return true;
  return false;
}
