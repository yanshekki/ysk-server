/**
 * Residual catch-all — domain routes live in dedicated modules.
 * handleMiscRoutes intentionally returns false for all paths (M3 drained).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';

export async function handleMiscRoutes(
  _ctx: AppContext,
  _req: IncomingMessage,
  _res: ServerResponse,
  _url: URL,
  _method: string,
): Promise<boolean> {
  // users/packages → admin; search; real-ip; dnssec; sftp/ssh → domain routes
  // webauthn/devices → auth; audit → audit
  // project detail/deploy/* → routes/projects.ts
  // agent runtime → agents; dashboard/notifications/apply-audit → dashboard
  // email domain mailboxes/aliases/… → email.ts
  // runtime tuning → hosting; AI tasks → ai; ssl/dns/cdn/db → domain files
  return false;
}
