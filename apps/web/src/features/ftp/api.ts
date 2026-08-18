/**
 * FTPS accounts + vsftpd service API
 */
import type { FtpsSettings, FtpsStatus, SelectOption } from 'ysk-server-shared';
import { api } from '../../shared/services/api';
import { resourcesApi } from '../resources/api';

export type { FtpsSettings, FtpsStatus, SelectOption } from 'ysk-server-shared';

export const ftpApi = {
  accounts: {
    list: () => resourcesApi.list('ftp/accounts'),
    create: (body: Record<string, unknown>) => resourcesApi.create('ftp/accounts', body),
    update: (id: string, body: Record<string, unknown>) =>
      resourcesApi.update('ftp/accounts', id, body),
    remove: (id: string) => resourcesApi.remove('ftp/accounts', id),
    apply: (id: string) => resourcesApi.apply('ftp/accounts', id, { execute: true }),
  },
  settings: () =>
    api.requestRaw<{ settings: FtpsSettings; status: FtpsStatus }>(
      '/api/v1/system/ftps/settings',
    ),
  saveSettings: (body: Partial<FtpsSettings>) =>
    api.requestRaw<{ ok: boolean; settings: FtpsSettings }>('/api/v1/system/ftps/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  status: () => api.requestRaw<FtpsStatus>('/api/v1/system/ftps/status'),
  options: (username?: string) => {
    const q = username ? `?username=${encodeURIComponent(username)}` : '';
    return api.requestRaw<{ domains: SelectOption[]; homes: SelectOption[] }>(
      `/api/v1/system/ftps/options${q}`,
    );
  },
  apply: (body?: {
    settings?: Partial<FtpsSettings>;
    applySystem?: boolean;
    allowPlaintextPublic?: boolean;
  }) =>
    api.requestRaw<Record<string, unknown>>('/api/v1/system/ftps/apply', {
      method: 'POST',
      body: JSON.stringify({ applySystem: true, ...body }),
    }),
};
