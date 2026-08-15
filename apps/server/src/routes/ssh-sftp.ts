/**
 * SFTP authorized keys + sshd snippet (Wave J2).
 * Extracted from ssh.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from 'ysk-server-shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSshSftpRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'GET' && url.pathname === '/api/v1/sftp/keys') {
        ctx.auth.authenticate(getBearer(req));
        const username = url.searchParams.get('username') ?? undefined;
        const { listSftpKeys } = await import('ysk-server-core');
        sendJson(res, 200, { items: listSftpKeys(ctx.db, username || undefined) });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/sftp/keys') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          username?: string;
          publicKey?: string;
          comment?: string;
          projectId?: string;
          linuxUser?: string;
        };
        const { addSftpKey, chownSftpProjectKeys } = await import('ysk-server-core');
        let linuxUser: string | undefined = data.linuxUser?.trim() || undefined;
        let homeDir: string | undefined;
        let username = data.username ?? '';
        if (data.projectId) {
          try {
            const proj = ctx.projects.get(data.projectId);
            linuxUser = linuxUser || proj.linuxUser;
            homeDir = proj.homeDir;
            username = username || proj.linuxUser;
          } catch {
            /* invalid project */
          }
        }
        if (linuxUser && !homeDir) {
          const ge = await ctx.host.runCommand(['getent', 'passwd', linuxUser], {
            timeoutMs: 8_000,
          });
          const home = (ge.stdout || '').split(':')[5]?.trim();
          if (home) homeDir = home;
          username = username || linuxUser;
        }
        const r = addSftpKey(ctx.db, ctx.dataDir, {
          username,
          publicKey: data.publicKey ?? '',
          comment: data.comment,
          projectId: data.projectId,
          linuxUser,
          homeDir,
        });
        if (r.ok && homeDir && linuxUser) {
          const ch = await chownSftpProjectKeys(ctx.host, homeDir, linuxUser);
          r.notes.push(...ch);
        }
        ctx.audit.append({
          actor: user.username,
          action: 'sftp.key.add',
          detail: {
            username: data.username,
            projectId: data.projectId,
            ok: r.ok,
          },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/sftp/sshd-snippet') {
        ctx.auth.authenticate(getBearer(req));
        const { buildSshdSftpSnippet } = await import('ysk-server-core');
        const chroot = url.searchParams.get('chroot') === '1';
        const snippet = buildSshdSftpSnippet({ chroot });
        sendJson(res, 200, {
          snippet,
          notes: [
            tl('notes.auto.n0680'),
            'Match User ysks_*,ysk_* + internal-sftp + AuthorizedKeysFile .ssh/authorized_keys',
          ],
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/sftp/sshd-snippet/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          chroot?: boolean;
          installSystem?: boolean;
        };
        const { applySshdSftpSnippet } = await import('ysk-server-core');
        const r = await applySshdSftpSnippet({
          dataDir: ctx.dataDir,
          host: ctx.host,
          db: ctx.db,
          chroot: data.chroot,
          installSystem: data.installSystem !== false,
        });
        if (r.ok) {
          try {
            const { syncServiceExposure } = await import('ysk-server-core');
            const exp = await syncServiceExposure({
              host: ctx.host,
              dataDir: ctx.dataDir,
              serviceId: 'sshd',
              ports: [{ role: 'ssh', port: '22', proto: 'tcp' }],
              reason: 'apply',
              requireDecision: false,
            });
            if (exp.notes?.length) {
              (r as { notes?: string[] }).notes = [
                ...((r as { notes?: string[] }).notes ?? []),
                ...exp.notes.slice(0, 2),
              ];
            }
          } catch {
            /* non-fatal */
          }
        }
        ctx.audit.append({
          actor: user.username,
          action: 'sftp.sshd_snippet.apply',
          detail: r,
          ok: r.ok,
        });
        sendJson(res, r.ok || r.written.length ? 200 : 422, r);
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/sftp\/keys\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { removeSftpKey } = await import('ysk-server-core');
        const r = removeSftpKey(ctx.db, ctx.dataDir, id);
        ctx.audit.append({
          actor: user.username,
          action: 'sftp.key.remove',
          resource: id,
          detail: r,
          ok: r.ok });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }

  return false;
}
