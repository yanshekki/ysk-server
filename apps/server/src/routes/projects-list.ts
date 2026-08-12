/**
 * Project list / get / templates (Wave Z2).
 * Extracted from projects-catalog.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProjectDto } from '@yanshekki/shared';
import { listAppTemplates } from '@yanshekki/core';
import type { AppContext } from '../app-context.js';
import { listWithQuery } from '../http/list-response.js';
import { getBearer, sendJson } from '../http/util.js';

export async function handleProjectsListRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/projects') {
    ctx.auth.authenticate(getBearer(req));
    const all = ctx.projects.list() as ProjectDto[];
    const { items, meta } = listWithQuery(
      url,
      all,
      {
        text: (p: ProjectDto) => [p.name, p.domain, p.id, p.linuxUser, p.runtime],
        predicates: {
          runtime: (p: ProjectDto, v: string) => p.runtime === v,
        },
        facetOf: {
          runtime: (p: ProjectDto) => p.runtime,
        },
        sortOf: {
          name: (a: ProjectDto, b: ProjectDto) => a.name.localeCompare(b.name),
          domain: (a: ProjectDto, b: ProjectDto) =>
            (a.domain ?? '').localeCompare(b.domain ?? ''),
        },
      },
      {
        enums: {
          runtime: ['node', 'php', 'static', 'python', 'go', 'rust'],
        },
        sortFields: ['name', 'domain'],
      },
    );
    sendJson(res, 200, { items, meta });
    return true;
  }
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+$/)) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    sendJson(res, 200, { project: ctx.projects.get(id) });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/templates') {
    ctx.auth.authenticate(getBearer(req));
    sendJson(res, 200, { items: listAppTemplates() });
    return true;
  }

  return false;
}
