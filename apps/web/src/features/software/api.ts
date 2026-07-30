/**
 * Unified one-click software install API
 */
import type { SoftwareStatus, SoftwareInstallResult } from '@ysk/shared';
import { api } from '../../shared/services/api';

export type { SoftwareStatus, SoftwareInstallResult } from '@ysk/shared';

export const softwareApi = {
  list: (feature?: string) => {
    const q = feature ? `?feature=${encodeURIComponent(feature)}` : '';
    return api.requestRaw<{
      items: SoftwareStatus[];
      missing: SoftwareStatus[];
      ready: boolean;
    }>(`/api/v1/system/software${q}`);
  },
  installOne: (id: string) =>
    api.requestRaw<SoftwareInstallResult>(`/api/v1/system/software/${id}/install`, {
      method: 'POST',
      body: '{}',
    }),
  installMany: (ids: string[]) =>
    api.requestRaw<SoftwareInstallResult>('/api/v1/system/software/install', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  installFeature: (feature: string) =>
    api.requestRaw<SoftwareInstallResult>('/api/v1/system/software/install', {
      method: 'POST',
      body: JSON.stringify({ feature }),
    }),
};
