/**
 * Managed resource CRUD client — /api/v1/resources/*
 */
import { api } from '../../shared/services/api';

export type ResourceRow = Record<string, unknown> & { id: string };

function base(collection: string) {
  return `/api/v1/resources/${collection}`;
}

export const resourcesApi = {
  list: (collection: string, query?: Record<string, string>) => {
    const q = query
      ? '?' +
        Object.entries(query)
          .filter(([, v]) => v != null && String(v) !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&')
      : '';
    return api.requestRaw<{
      items: ResourceRow[];
      allTotal?: number;
      meta?: {
        total: number;
        page: number;
        limit: number;
        q: string;
        filters: Record<string, string>;
        order: 'asc' | 'desc';
        allTotal?: number;
      };
    }>(`${base(collection)}${q}`);
  },
  get: (collection: string, id: string) =>
    api.requestRaw<{ item: ResourceRow }>(`${base(collection)}/${id}`),
  create: (collection: string, body: Record<string, unknown>) =>
    api.requestRaw<{ item: ResourceRow }>(base(collection), {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (collection: string, id: string, body: Record<string, unknown>) =>
    api.requestRaw<{ item: ResourceRow }>(`${base(collection)}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  remove: (collection: string, id: string) =>
    api.requestRaw<{ ok: boolean; notes?: string[] }>(`${base(collection)}/${id}`, {
      method: 'DELETE',
    }),
  apply: (collection: string, id: string, body?: { execute?: boolean }) =>
    api.requestRaw<{ ok: boolean; notes?: string[]; site?: ResourceRow; result?: unknown }>(
      `${base(collection)}/${id}/apply`,
      {
        method: 'POST',
        body: JSON.stringify({ execute: body?.execute !== false }),
      },
    ),
};
