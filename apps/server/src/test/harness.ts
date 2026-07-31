/**
 * Server test harness — real tmp dataDir + HTTP listen.
 * Prefer this over mocking honesty layers.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { runSetup } from '../cli/setup.js';
import { createAppContext, closeAppContext, type AppContext } from '../app-context.js';
import { createHttpServer, listen } from '../http-server.js';
import { loadConfigFile } from '../config-loader.js';
import { VERSION } from '../version.js';

export type TestServer = {
  dataDir: string;
  baseUrl: string;
  ctx: AppContext;
  server: Server;
  token: string;
  close: () => Promise<void>;
};

export async function startTestServer(opts?: {
  adminPassword?: string;
  port?: number;
}): Promise<TestServer> {
  const adminPassword = opts?.adminPassword ?? 'TestPass-Strong-99!';
  const dataDir = mkdtempSync(join(tmpdir(), 'ysk-srv-test-'));
  // setup rejects port 0; ephemeral bind happens in listen() below
  const setup = runSetup({
    dataDir,
    nonInteractive: true,
    listenPort: opts?.port && opts.port > 0 ? opts.port : 19287,
    locale: 'en',
    adminUsername: 'admin',
    adminPassword,
    force: true,
    allowInsecureDefaults: true,
  });
  if (!setup.ok || !setup.data) {
    rmSync(dataDir, { recursive: true, force: true });
    throw new Error(`setup failed: ${JSON.stringify(setup)}`);
  }
  const cfg = loadConfigFile(setup.data.configPath);
  const ctx = createAppContext({
    version: VERSION,
    config: cfg,
    configPath: setup.data.configPath,
    dataDir,
    adminPassword,
  });
  const server = createHttpServer(ctx);
  await listen(server, '127.0.0.1', 0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  if (!port) {
    server.close();
    closeAppContext(ctx);
    rmSync(dataDir, { recursive: true, force: true });
    throw new Error('failed to bind ephemeral port');
  }
  const baseUrl = `http://127.0.0.1:${port}`;

  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept-language': 'en' },
    body: JSON.stringify({ username: 'admin', password: adminPassword }),
  });
  const loginBody = (await loginRes.json()) as { token?: string };
  if (!loginRes.ok || !loginBody.token) {
    server.close();
    closeAppContext(ctx);
    rmSync(dataDir, { recursive: true, force: true });
    throw new Error(`login failed: ${loginRes.status} ${JSON.stringify(loginBody)}`);
  }

  return {
    dataDir,
    baseUrl,
    ctx,
    server,
    token: loginBody.token,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      closeAppContext(ctx);
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function apiJson(
  ts: TestServer,
  method: string,
  path: string,
  body?: unknown,
  opts?: { auth?: boolean },
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'accept-language': 'en',
  };
  if (opts?.auth !== false) {
    headers.authorization = `Bearer ${ts.token}`;
  }
  let payload: string | undefined;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${ts.baseUrl}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* raw */
  }
  return { status: res.status, body: parsed };
}

/** Assert ops honesty shape — never treat fake success as pass. */
export function expectHonestOps(body: unknown): asserts body is {
  ok: boolean;
  notes?: string[];
  apply_status?: string;
  requiresExecute?: boolean;
  blocked?: boolean;
} {
  if (!body || typeof body !== 'object') {
    throw new Error('expected ops object');
  }
  const o = body as Record<string, unknown>;
  if (typeof o.ok !== 'boolean') {
    throw new Error('ops missing ok');
  }
  if (o.ok === true && o.blocked === true) {
    throw new Error('honesty violation: ok && blocked');
  }
  if (o.apply_status === 'applied' && o.ok !== true) {
    throw new Error('honesty violation: applied without ok');
  }
}
