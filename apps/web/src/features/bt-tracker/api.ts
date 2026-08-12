/**
 * BitTorrent tracker service API (file-share WebTorrent/BT).
 */
import type { BtTrackerSettings, BtTrackerStatus, BtTrackerTorrentRow, BtShareStats } from '@ysk/shared';
import { api } from '../../shared/services/api';

export type { BtTrackerSettings, BtTrackerStatus, BtTrackerTorrentRow, BtShareStats };

export type BtTrackerStatusDto = BtTrackerStatus & { ok?: boolean };

export const btTrackerApi = {
  status: () =>
    api.requestRaw<BtTrackerStatusDto>('/api/v1/system/bt-tracker/status'),

  settings: () =>
    api.requestRaw<{ ok: boolean; settings: BtTrackerSettings }>(
      '/api/v1/system/bt-tracker/settings',
    ),

  saveSettings: (body: Partial<BtTrackerSettings>) =>
    api.requestRaw<{ ok: boolean; settings: BtTrackerSettings }>(
      '/api/v1/system/bt-tracker/settings',
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

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

  shareBtStats: (id: string) =>
    api.requestRaw<{ ok: boolean; stats: BtShareStats }>(
      `/api/v1/files/shares/${encodeURIComponent(id)}/bt-stats`,
    ),

  shareBtStatsBatch: (ids: string[]) =>
    api.requestRaw<{ ok: boolean; items: Record<string, BtShareStats> }>(
      '/api/v1/files/shares/bt-stats',
      { method: 'POST', body: JSON.stringify({ ids }) },
    ),
};
