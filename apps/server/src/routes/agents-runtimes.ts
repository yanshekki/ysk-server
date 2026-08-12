/**
 * Agent runtime probe / plan / unit / install (Wave X3).
 * Extracted from agents.ts. Behaviour preserved.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  probeAllAgentRuntimes,
  applyAgentInstall,
  parseAgentKind,
  planAgentInstall,
  probeAgentRuntime,
  renderAgentSystemdUnit,
} from '@ysk-server/core';
import type { AppContext } from '../app-context.js';
import { listWithQuery } from '../http/list-response.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';

export async function handleAgentsRuntimesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/agents/runtimes') {
    ctx.auth.authenticate(getBearer(req));
    type Probe = { kind?: string; id?: string; name?: string; status?: string; version?: string };
    const probes = (await probeAllAgentRuntimes(ctx.host)) as unknown as Probe[];
    const { items, meta } = listWithQuery(url, probes, {
      text: (p: Probe) => [
        String(p.kind ?? p.id ?? ''),
        String(p.name ?? ''),
        String(p.status ?? ''),
        String(p.version ?? ''),
      ],
    });
    sendJson(res, 200, { items, meta });
    return true;
  }
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/agents\/runtimes\/[^/]+$/)) {
    ctx.auth.authenticate(getBearer(req));
    const kind = url.pathname.split('/')[5];
    const probe = await probeAgentRuntime(kind, ctx.host);
    sendJson(res, 200, { runtime: probe });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/agents\/runtimes\/[^/]+\/plan$/)) {
    ctx.auth.authenticate(getBearer(req));
    const kind = parseAgentKind(url.pathname.split('/')[5]);
    sendJson(res, 200, planAgentInstall(kind));
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/agents\/runtimes\/[^/]+\/unit$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const kind = parseAgentKind(url.pathname.split('/')[5]);
    const plan = planAgentInstall(kind);
    const unitsDir = join(ctx.dataDir, 'systemd');
    mkdirSync(unitsDir, { recursive: true });
    const unitName = `ysk-agent-${kind}.service`;
    const unitPath = join(unitsDir, unitName);
    const content = renderAgentSystemdUnit({
      kind,
      installPath: plan.runtime.installPath ?? `/opt/ysk-server/agents/${kind}`,
      nodePath: process.execPath });
    writeFileSync(unitPath, content, 'utf8');
    ctx.audit.append({
      actor: user.username,
      action: 'agent.unit.write',
      resource: kind,
      detail: { unitPath },
      ok: true });
    sendJson(res, 200, {
      ok: true,
      unitPath,
      unitName,
      notes: [
        `Unit template written to ${unitPath}`,
        'Enable with root + YSK_EXECUTE: cp to /etc/systemd/system && systemctl enable --now',
      ] });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/agents\/runtimes\/[^/]+\/install$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const kind = parseAgentKind(url.pathname.split('/')[5]);
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { execute?: boolean; enableUnit?: boolean };
    const result = await applyAgentInstall({
      dataDir: ctx.dataDir,
      kind,
      host: ctx.host,
      execute: data.execute,
      enableUnit: data.enableUnit,
      nodePath: process.execPath });
    ctx.audit.append({
      actor: user.username,
      action: 'agent.install',
      resource: kind,
      detail: {
        ok: result.ok,
        enabled: result.enabled,
        requiresExecute: result.requiresExecute,
        notes: result.notes },
      ok: result.ok });
    sendOpsResult(res, result);
    return true;
  }

  return false;
}
