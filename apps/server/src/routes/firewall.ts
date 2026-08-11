/**
 * Firewall + Fail2ban dispatcher (Wave V2).
 * ufw → service-exposure → fail2ban
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { handleFirewallUfwRoutes } from './firewall-ufw.js';
import { handleFirewallFail2banRoutes } from './firewall-fail2ban.js';
import { handleServiceExposureRoutes } from './service-exposure.js';

export async function handleFirewallRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (await handleFirewallUfwRoutes(ctx, req, res, url, method)) return true;
  if (await handleServiceExposureRoutes(ctx, req, res, url, method)) return true;
  if (await handleFirewallFail2banRoutes(ctx, req, res, url, method)) return true;
  return false;
}
