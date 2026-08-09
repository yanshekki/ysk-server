/**
 * Auth routes dispatcher (Wave L3).
 * session → mfa
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleAuthSessionRoutes } from './auth-session.js';
import { handleAuthMfaRoutes } from './auth-mfa.js';

export async function handleAuthRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleAuthSessionRoutes(ctx, req, res, url, method)) return true;
  if (await handleAuthMfaRoutes(ctx, req, res, url, method)) return true;
  return false;
}
