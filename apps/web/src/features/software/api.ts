/**
 * Unified one-click software install API
 */
import { api } from '../../shared/services/api';

export type SoftwareStatus = {
  id: string;
  title: string;
  installed: boolean;
  active?: string;
  bins: string[];
  missingBins: string[];
  features: string[];
};

export type SoftwareInstallResult = {
  ok: boolean;
  executed?: boolean;
  blocked?: boolean;
  blockMessage?: string;
  id?: string;
  title?: string;
  installed?: boolean;
  notes?: string[];
  steps?: Array<{ name: string; status: string; detail?: string }>;
  status?: SoftwareStatus;
  results?: SoftwareInstallResult[];
};

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
