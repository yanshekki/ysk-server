/**
 * BitTorrent tracker service API (file-share WebTorrent/BT).
 */
import type {
  BtTrackerSettings,
  BtTrackerStatus,
  BtTrackerTorrentRow,
  BtShareStats,
  BtLibraryInspect,
  BtLibraryDestProbe,
  BtLibraryDestMode,
  BtLibraryItem,
  BtExtraTracker,
} from 'ysk-server-shared';
import { api } from '../../shared/services/api';

export type {
  BtTrackerSettings,
  BtTrackerStatus,
  BtTrackerTorrentRow,
  BtShareStats,
  BtLibraryInspect,
  BtLibraryDestProbe,
  BtLibraryDestMode,
  BtLibraryItem,
  BtExtraTracker,
};

export type BtLibraryLive = BtLibraryItem & {
  progress?: number;
  downloadSpeed?: number;
  uploadSpeed?: number;
  peers?: number;
  downloaded?: number;
  hint?: string;
};

export type BtTrackerStatusDto = BtTrackerStatus & { ok?: boolean };

export const btTrackerApi = {
  status: () =>
    api.requestRaw<BtTrackerStatusDto>('/api/v1/system/bt-tracker/status'),

  settings: () =>
    api.requestRaw<{ ok: boolean; settings: BtTrackerSettings }>(
      '/api/v1/system/bt-tracker/settings',
    ),

  saveSettings: (body: Partial<BtTrackerSettings>) =>
    api.requestRaw<{
      ok: boolean;
      settings: BtTrackerSettings;
      restartRequired?: boolean;
      notes?: string[];
    }>('/api/v1/system/bt-tracker/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  start: () =>
    api.requestRaw<Record<string, unknown>>('/api/v1/system/bt-tracker/start', {
      method: 'POST',
      body: '{}',
    }),

  stop: () =>
    api.requestRaw<Record<string, unknown>>('/api/v1/system/bt-tracker/stop', {
      method: 'POST',
      body: '{}',
    }),

  torrents: () =>
    api.requestRaw<{ ok: boolean; items: BtTrackerTorrentRow[] }>(
      '/api/v1/system/bt-tracker/torrents',
    ),

  restore: () =>
    api.requestRaw<Record<string, unknown>>('/api/v1/system/bt-tracker/restore', {
      method: 'POST',
      body: '{}',
    }),

  jobs: () =>
    api.requestRaw<{
      ok: boolean;
      items: Array<{
        id: string;
        shareId: string;
        status: string;
        enqueuedAt: string;
        startedAt?: string;
        finishedAt?: string;
        notes: string[];
        estimatedBytes?: number;
      }>;
    }>('/api/v1/system/bt-tracker/jobs'),

  job: (id: string) =>
    api.requestRaw<{
      ok: boolean;
      job: {
        id: string;
        shareId: string;
        status: string;
        enqueuedAt: string;
        notes: string[];
      };
    }>(`/api/v1/system/bt-tracker/jobs/${encodeURIComponent(id)}`),

  shareBtStats: (id: string) =>
    api.requestRaw<{ ok: boolean; stats: BtShareStats }>(
      `/api/v1/files/shares/${encodeURIComponent(id)}/bt-stats`,
    ),

  shareBtStatsBatch: (ids: string[]) =>
    api.requestRaw<{ ok: boolean; items: Record<string, BtShareStats> }>(
      '/api/v1/files/shares/bt-stats',
      { method: 'POST', body: JSON.stringify({ ids }) },
    ),

  inspect: (body: { torrentBase64?: string; magnet?: string }) =>
    api.requestRaw<BtLibraryInspect & { ok: boolean }>(
      '/api/v1/system/bt-tracker/library/inspect',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  probeDest: (body: {
    saveRoot: string;
    parentRel: string;
    name: string;
    files: Array<{ path: string; length: number }>;
  }) =>
    api.requestRaw<BtLibraryDestProbe & { ok: boolean }>(
      '/api/v1/system/bt-tracker/library/probe',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  addLibrary: (body: {
    torrentBase64?: string;
    magnet?: string;
    saveRoot: string;
    saveRelPath: string;
    parentRel?: string;
    mode?: BtLibraryDestMode;
  }) =>
    api.requestRaw<{ ok: boolean; item?: BtLibraryItem; notes?: string[] }>(
      '/api/v1/system/bt-tracker/library',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  library: () =>
    api.requestRaw<{ ok: boolean; items: BtLibraryLive[] }>(
      '/api/v1/system/bt-tracker/library',
    ),

  libraryItem: (id: string) =>
    api.requestRaw<{ ok: boolean; item: BtLibraryLive }>(
      `/api/v1/system/bt-tracker/library/${encodeURIComponent(id)}`,
    ),

  pauseLibrary: (id: string) =>
    api.requestRaw<{ ok: boolean; item?: BtLibraryItem; notes?: string[] }>(
      `/api/v1/system/bt-tracker/library/${encodeURIComponent(id)}/pause`,
      { method: 'POST', body: '{}' },
    ),

  resumeLibrary: (id: string) =>
    api.requestRaw<{ ok: boolean; item?: BtLibraryItem; notes?: string[] }>(
      `/api/v1/system/bt-tracker/library/${encodeURIComponent(id)}/resume`,
      { method: 'POST', body: '{}' },
    ),

  removeLibrary: (id: string, deleteFiles = false) =>
    api.requestRaw<{ ok: boolean; notes?: string[] }>(
      `/api/v1/system/bt-tracker/library/${encodeURIComponent(id)}?deleteFiles=${deleteFiles ? '1' : '0'}`,
      { method: 'DELETE' },
    ),

  applyTrackers: () =>
    api.requestRaw<{ ok: boolean; applied: number; notes?: string[] }>(
      '/api/v1/system/bt-tracker/library/apply-trackers',
      { method: 'POST', body: '{}' },
    ),
};
