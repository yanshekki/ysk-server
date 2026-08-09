/**
 * Email webmail dispatcher (Wave W1).
 * apply → sso/sieve
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleEmailWebmailApplyRoutes } from './email-webmail-apply.js';
import { handleEmailWebmailSsoRoutes } from './email-webmail-sso.js';

export async function handleEmailWebmailRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleEmailWebmailApplyRoutes(ctx, req, res, url, method)) return true;
  if (await handleEmailWebmailSsoRoutes(ctx, req, res, url, method)) return true;
  return false;
}
