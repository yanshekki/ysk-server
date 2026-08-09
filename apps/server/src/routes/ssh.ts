/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  YskError,  tl} from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSshRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'GET' && url.pathname === '/api/v1/sftp/keys') {
        ctx.auth.authenticate(getBearer(req));
        const username = url.searchParams.get('username') ?? undefined;
        const { listSftpKeys } = await import('@ysk/core');
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
        };
        const { addSftpKey, chownSftpProjectKeys } = await import('@ysk/core');
        let linuxUser: string | undefined;
        let homeDir: string | undefined;
        let username = data.username ?? '';
        if (data.projectId) {
          try {
            const proj = ctx.projects.get(data.projectId);
            linuxUser = proj.linuxUser;
            homeDir = proj.homeDir;
            username = username || proj.linuxUser;
          } catch {
            /* invalid project */
          }
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
        const { buildSshdSftpSnippet } = await import('@ysk/core');
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
        const { applySshdSftpSnippet } = await import('@ysk/core');
        const r = await applySshdSftpSnippet({
          dataDir: ctx.dataDir,
          host: ctx.host,
          db: ctx.db,
          chroot: data.chroot,
          installSystem: data.installSystem !== false,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'sftp.sshd_snippet.apply',
          detail: r,
          ok: r.ok,
        });
        sendJson(res, r.ok || r.written.length ? 200 : 422, r);
        return true;
      }
      // —— SSH identity vault (outbound private keys; distinct from sftp authorized_keys) ——
      if (method === 'GET' && url.pathname === '/api/v1/ssh/identities') {
        ctx.auth.authenticate(getBearer(req));
        const { listSshIdentities } = await import('@ysk/core');
        const purposeRaw = url.searchParams.get('purpose') ?? undefined;
        const purpose =
          purposeRaw === 'user_outbound' ||
          purposeRaw === 'panel_outbound' ||
          purposeRaw === 'unbound'
            ? purposeRaw
            : undefined;
        sendJson(res, 200, {
          ok: true,
          items: listSshIdentities(ctx.dataDir, {
            projectId: url.searchParams.get('projectId') ?? undefined,
            linuxUser: url.searchParams.get('linuxUser') ?? undefined,
            purpose,
          }),
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/ssh/identities') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          name?: string;
          comment?: string;
          algorithm?: 'ed25519' | 'rsa-4096';
          purpose?: 'user_outbound' | 'panel_outbound' | 'unbound';
          binding?: { projectId?: string; linuxUser?: string; homeDir?: string };
          revealPrivate?: boolean;
          install?: boolean;
        };
        const { createSshIdentity, installSshIdentity } = await import('@ysk/core');
        const r = createSshIdentity(
          ctx.dataDir,
          {
            name: data.name ?? '',
            comment: data.comment,
            algorithm: data.algorithm,
            purpose: data.purpose,
            binding: data.binding,
            createdBy: user.username,
            revealPrivate: data.revealPrivate === true,
          },
          ctx.db,
        );
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.create',
          resource: r.identity?.id,
          detail: {
            name: data.name,
            purpose: data.purpose,
            fingerprint: r.identity?.fingerprintSha256,
            ok: r.ok,
          },
          ok: r.ok,
        });
        if (r.ok && data.install && r.identity) {
          const inst = await installSshIdentity({
            dataDir: ctx.dataDir,
            id: r.identity.id,
            apply: true,
            host: ctx.host,
            executeEnabled: ctx.host.executeEnabled(),
          });
          sendJson(res, r.ok ? 201 : 422, { ...r, install: inst });
          return true;
        }
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/ssh/identities/import') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          name?: string;
          privateKey?: string;
          comment?: string;
          purpose?: 'user_outbound' | 'panel_outbound' | 'unbound';
          binding?: { projectId?: string; linuxUser?: string; homeDir?: string };
        };
        const { importSshIdentity } = await import('@ysk/core');
        const r = importSshIdentity(
          ctx.dataDir,
          {
            name: data.name ?? '',
            privateKey: data.privateKey ?? '',
            comment: data.comment,
            purpose: data.purpose,
            binding: data.binding,
            createdBy: user.username,
          },
          ctx.db,
        );
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.import',
          resource: r.identity?.id,
          detail: {
            name: data.name,
            fingerprint: r.identity?.fingerprintSha256,
            ok: r.ok,
          },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      // —— SSH login 2FA (TOTP/PAM; independent of panel operator 2FA) ——
      if (method === 'GET' && url.pathname === '/api/v1/ssh/2fa') {
        ctx.auth.authenticate(getBearer(req));
        const { listSsh2fa, probeSsh2faHost } = await import('@ysk/core');
        const items = listSsh2fa(ctx.dataDir, {
          projectId: url.searchParams.get('projectId') ?? undefined,
          linuxUser: url.searchParams.get('linuxUser') ?? undefined,
        });
        const hostProbe = await probeSsh2faHost(ctx.host).catch(() => ({
          notes: ['host probe skipped'],
        }));
        sendJson(res, 200, { ok: true, items, host: hostProbe });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/ssh/2fa/pam-snippet') {
        ctx.auth.authenticate(getBearer(req));
        const { buildPamSshSnippet, buildSshdTotpHints, listSsh2fa, planSsh2faStrictSnippet } =
          await import('@ysk/core');
        const written = listSsh2fa(ctx.dataDir)
          .filter((i) => i.status === 'file_written')
          .map((i) => i.linuxUser);
        const strict = planSsh2faStrictSnippet({
          linuxUsers: written,
          recoveryUsers: (url.searchParams.get('recovery') ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        });
        sendJson(res, 200, {
          ok: true,
          pamSnippet: buildPamSshSnippet(),
          sshdHints: buildSshdTotpHints(),
          strictSnippet: strict.snippet,
          strictUsers: strict.users,
          strictNotes: strict.notes,
          notes: [
            tl('notes.auto.n0350'),
            tl('notes.auto.n0675'),
            tl('notes.auto.n0438'),
            tl('notes.auto.n1344'),
          ],
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/ssh/2fa/strict-apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        if (!user.roles?.includes('admin')) {
          sendJson(res, 403, { ok: false, message: tl('notes.auto.n1559') });
          return true;
        }
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          apply?: boolean;
          recoveryUsers?: string[];
          totp?: string;
        };
        try {
          if (data.apply) ctx.auth.requireStepUp(user.id, data.totp);
        } catch (e) {
          if (e instanceof YskError) {
            sendJson(res, e.httpStatus || 403, {
              ok: false,
              code: e.code,
              message: e.message,
              needsStepUp: true,
            });
            return true;
          }
          throw e;
        }
        const { listSsh2fa, applySshdStrictSnippet } = await import('@ysk/core');
        const written = listSsh2fa(ctx.dataDir)
          .filter((i) => i.status === 'file_written')
          .map((i) => i.linuxUser);
        const r = await applySshdStrictSnippet({
          dataDir: ctx.dataDir,
          host: ctx.host,
          linuxUsers: written,
          recoveryUsers: data.recoveryUsers ?? ['root'],
          apply: data.apply === true,
          executeEnabled: ctx.host.executeEnabled(),
        });
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.2fa.strict_apply',
          detail: { apply: data.apply === true, ok: r.ok, users: written },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/ssh/2fa') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          projectId?: string;
          linuxUser?: string;
          homeDir?: string;
          /** advanced: copy panel operator secret */
          fromPanel?: boolean;
        };
        const { enrollSsh2fa } = await import('@ysk/core');
        let secret: string | undefined;
        let fromPanel = false;
        if (data.fromPanel === true) {
          if (!user.roles?.includes('admin')) {
            sendJson(res, 403, {
              ok: false,
              code: 'YSK_FORBIDDEN',
              message: tl('notes.auto.n0293'),
            });
            return true;
          }
          const me = ctx.db.snapshot.users.find((u) => u.id === user.id);
          if (!me?.totp_secret) {
            sendJson(res, 422, {
              ok: false,
              notes: [tl('notes.auto.n0364')],
            });
            return true;
          }
          try {
            ctx.auth.requireStepUp(user.id); // need recent step-up or fail
          } catch {
            sendJson(res, 403, {
              ok: false,
              needsStepUp: true,
              notes: [tl('notes.auto.n0294')],
            });
            return true;
          }
          const { decryptTotpSecret } = await import('@ysk/core');
          secret = decryptTotpSecret(ctx.dataDir, user.id, me.totp_secret);
          fromPanel = true;
        }
        const r = enrollSsh2fa(
          ctx.dataDir,
          {
            projectId: data.projectId,
            linuxUser: data.linuxUser,
            homeDir: data.homeDir,
            createdBy: user.username,
            secret,
            fromPanel,
          },
          ctx.db,
        );
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.2fa.enroll',
          resource: r.record?.id,
          detail: {
            linuxUser: r.record?.linuxUser,
            fromPanel,
            ok: r.ok,
          },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/sftp\/keys\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { removeSftpKey } = await import('@ysk/core');
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
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/public$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { getSshIdentity } = await import('@ysk/core');
        const identity = getSshIdentity(ctx.dataDir, id);
        if (!identity) {
          sendJson(res, 404, { ok: false, message: tl('notes.ssh.identityNotFound') });
          return true;
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.statusCode = 200;
        res.end(identity.publicKey.endsWith('\n') ? identity.publicKey : identity.publicKey + '\n');
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/export$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        if (!user.roles?.includes('admin')) {
          sendJson(res, 403, {
            ok: false,
            code: 'YSK_FORBIDDEN',
            message: tl('notes.auto.n0281') });
          return true;
        }
        const rawBody = await readBody(req).catch(() => '{}');
        const expData = JSON.parse(rawBody || '{}') as { totp?: string };
        try {
          ctx.auth.requireStepUp(user.id, expData.totp);
        } catch (e) {
          if (e instanceof YskError) {
            sendJson(res, e.httpStatus || 403, {
              ok: false,
              code: e.code,
              message: e.message,
              needsStepUp: true });
            return true;
          }
          throw e;
        }
        const id = url.pathname.split('/')[5];
        const { exportSshIdentityPrivate } = await import('@ysk/core');
        const r = exportSshIdentityPrivate(ctx.dataDir, id);
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.export',
          resource: id,
          detail: { fingerprint: r.fingerprintSha256, ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/install$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { apply?: boolean };
        const { installSshIdentity } = await import('@ysk/core');
        const r = await installSshIdentity({
          dataDir: ctx.dataDir,
          id,
          apply: data.apply === true,
          host: ctx.host,
          executeEnabled: ctx.host.executeEnabled() });
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.install',
          resource: id,
          detail: {
            apply: data.apply === true,
            applied: r.applied,
            path: r.plannedPath,
            ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/uninstall$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { apply?: boolean; purgeFiles?: boolean };
        const { uninstallSshIdentity } = await import('@ysk/core');
        const r = await uninstallSshIdentity({
          dataDir: ctx.dataDir,
          id,
          apply: data.apply === true,
          purgeFiles: data.purgeFiles !== false });
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.uninstall',
          resource: id,
          detail: { apply: data.apply === true, ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/test$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { target?: string; apply?: boolean };
        const { testSshIdentity } = await import('@ysk/core');
        const r = await testSshIdentity({
          dataDir: ctx.dataDir,
          id,
          target: data.target ?? '',
          apply: data.apply === true,
          host: ctx.host,
          executeEnabled: ctx.host.executeEnabled() });
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.test',
          resource: id,
          detail: {
            target: data.target,
            apply: data.apply === true,
            ok: r.ok,
            dryRun: r.dryRun },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/rotate$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { revealPrivate?: boolean };
        const { rotateSshIdentity } = await import('@ysk/core');
        const r = rotateSshIdentity({
          dataDir: ctx.dataDir,
          id,
          revealPrivate: data.revealPrivate === true,
          db: ctx.db });
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.rotate',
          resource: id,
          detail: {
            newId: r.newIdentity?.id,
            fingerprint: r.newIdentity?.fingerprintSha256,
            ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/authorize-self$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { authorizeSelfSshIdentity } = await import('@ysk/core');
        const r = await authorizeSelfSshIdentity({
          dataDir: ctx.dataDir,
          db: ctx.db,
          id,
          host: ctx.host });
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.authorize_self',
          resource: id,
          detail: { keyId: r.keyId, ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { getSshIdentity } = await import('@ysk/core');
        const identity = getSshIdentity(ctx.dataDir, id);
        if (!identity) {
          sendJson(res, 404, { ok: false, message: tl('notes.ssh.identityNotFound') });
          return true;
        }
        sendJson(res, 200, { ok: true, identity });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const purgeDisk = url.searchParams.get('purgeDisk') === '1';
        const { deleteSshIdentity, uninstallSshIdentity } = await import('@ysk/core');
        if (purgeDisk) {
          await uninstallSshIdentity({
            dataDir: ctx.dataDir,
            id,
            apply: true,
            purgeFiles: true });
        }
        const r = deleteSshIdentity(ctx.dataDir, id);
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.delete',
          resource: id,
          detail: { purgeDisk, ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/2fa\/[^/]+\/confirm$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { code?: string };
        const { confirmSsh2fa } = await import('@ysk/core');
        const r = confirmSsh2fa(ctx.dataDir, id, data.code ?? '');
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.2fa.confirm',
          resource: id,
          detail: { ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/2fa\/[^/]+\/install$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { apply?: boolean };
        const { installSsh2faFile } = await import('@ysk/core');
        const r = await installSsh2faFile({
          dataDir: ctx.dataDir,
          id,
          apply: data.apply === true,
          host: ctx.host,
          executeEnabled: ctx.host.executeEnabled() });
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.2fa.install',
          resource: id,
          detail: { apply: data.apply === true, applied: r.applied, ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/2fa\/[^/]+\/uninstall$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { apply?: boolean };
        const { uninstallSsh2faFile } = await import('@ysk/core');
        const r = await uninstallSsh2faFile({
          dataDir: ctx.dataDir,
          id,
          apply: data.apply === true,
          retire: true });
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.2fa.uninstall',
          resource: id,
          detail: { ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/2fa\/[^/]+\/reveal$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        if (!user.roles?.includes('admin')) {
          sendJson(res, 403, { ok: false, code: 'YSK_FORBIDDEN', message: tl('notes.auto.n0561') });
          return true;
        }
        const id = url.pathname.split('/')[5];
        const { revealSsh2faSecret } = await import('@ysk/core');
        const r = revealSsh2faSecret(ctx.dataDir, id);
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.2fa.reveal',
          resource: id,
          detail: { ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/ssh\/2fa\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { retireSsh2fa, uninstallSsh2faFile } = await import('@ysk/core');
        if (url.searchParams.get('purgeFile') === '1') {
          await uninstallSsh2faFile({ dataDir: ctx.dataDir, id, apply: true, retire: true });
        } else {
          retireSsh2fa(ctx.dataDir, id);
        }
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.2fa.retire',
          resource: id,
          detail: {},
          ok: true });
        sendJson(res, 200, { ok: true });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/security/fail2ban-snippets') {
        ctx.auth.authenticate(getBearer(req));
        const { writeFail2banSnippets } = await import('@ysk/core');
        sendJson(res, 200, writeFail2banSnippets(ctx.dataDir));
        return true;
      }
  return false;
}
