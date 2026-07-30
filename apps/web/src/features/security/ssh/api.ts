import { api } from '../../../shared/services/api';
import type { ProjectOpt, SftpKeyRow, SshIdentityRow } from './types';

export const sshApi = {
  listIdentities: () =>
    api.requestRaw<{ ok?: boolean; items: SshIdentityRow[] }>('/api/v1/ssh/identities'),

  createIdentity: (body: Record<string, unknown>) =>
    api.requestRaw<{
      ok: boolean;
      identity?: SshIdentityRow;
      privateKey?: string;
      notes?: string[];
    }>('/api/v1/ssh/identities', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  install: (id: string, apply: boolean) =>
    api.requestRaw<{
      ok: boolean;
      applied?: boolean;
      blocked?: boolean;
      dryRun?: boolean;
      notes?: string[];
    }>(`/api/v1/ssh/identities/${id}/install`, {
      method: 'POST',
      body: JSON.stringify({ apply }),
    }),

  test: (id: string, target: string, apply: boolean) =>
    api.requestRaw<{
      ok: boolean;
      dryRun?: boolean;
      blocked?: boolean;
      notes?: string[];
    }>(`/api/v1/ssh/identities/${id}/test`, {
      method: 'POST',
      body: JSON.stringify({ target, apply }),
    }),

  authorizeSelf: (id: string) =>
    api.requestRaw<{ ok: boolean; notes?: string[] }>(
      `/api/v1/ssh/identities/${id}/authorize-self`,
      { method: 'POST', body: '{}' },
    ),

  rotate: (id: string, revealPrivate: boolean) =>
    api.requestRaw<{
      ok: boolean;
      privateKey?: string;
      newIdentity?: SshIdentityRow;
      notes?: string[];
    }>(`/api/v1/ssh/identities/${id}/rotate`, {
      method: 'POST',
      body: JSON.stringify({ revealPrivate }),
    }),

  remove: (id: string, purgeDisk = true) =>
    api.requestRaw(`/api/v1/ssh/identities/${id}?purgeDisk=${purgeDisk ? '1' : '0'}`, {
      method: 'DELETE',
    }),

  listLoginKeys: () =>
    api.requestRaw<{ items: SftpKeyRow[] }>('/api/v1/sftp/keys'),

  addLoginKey: (body: {
    projectId: string;
    publicKey: string;
    comment?: string;
  }) =>
    api.requestRaw<{ ok: boolean; notes?: string[] }>('/api/v1/sftp/keys', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  removeLoginKey: (id: string) =>
    api.requestRaw(`/api/v1/sftp/keys/${id}`, { method: 'DELETE' }),

  sshdSnippet: () =>
    api.requestRaw<{ snippet: string; notes: string[] }>('/api/v1/sftp/sshd-snippet'),

  applySshd: () =>
    api.requestRaw<{ ok: boolean; notes: string[] }>('/api/v1/sftp/sshd-snippet/apply', {
      method: 'POST',
      body: JSON.stringify({ installSystem: true, chroot: false }),
    }),

  listProjects: async (): Promise<ProjectOpt[]> => {
    const r = await api.listProjects();
    return (r.items ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      linuxUser: p.linuxUser,
      homeDir: p.homeDir,
    }));
  },
};
