import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

/** Keep inventory HTTP tests off real apt/dpkg (slow/hang on CI runners). */
function stubHostInventory(ts: TestServer) {
  const host = ts.ctx.host;
  const orig = host.runCommand.bind(host);
  host.runCommand = async (argv, opts) => {
    const j = argv.join(' ');
    if (
      j.includes('apt list') ||
      j.includes('apt-get') ||
      j.includes('apt-cache') ||
      j.includes('dpkg-query')
    ) {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
      };
    }
    return orig(argv, opts);
  };
}


describe('updates routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated scheduler list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/scheduler', undefined, {
      auth: false,
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists scheduler jobs when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/scheduler');
    expect(res.status).toBe(200);
    const body = res.body as { jobs?: unknown[] };
    expect(Array.isArray(body.jobs)).toBe(true);
  });

  it(
    'returns inventory when authenticated (cached path)',
    async () => {
      ts = await startTestServer();
      stubHostInventory(ts);
      ts.ctx.settings.setJson('last_inventory', {
        at: new Date().toISOString(),
        count: 1,
        upgradable: 0,
        meta: { upgradableCount: 0 },
        sample: [{ name: 'bash', version: '5.0' }],
        items: [
          { name: 'bash', version: '5.0', packageName: 'bash', upgradable: false },
        ],
        advice: [],
        stale: false,
      });
      const res = await apiJson(ts, 'GET', '/api/v1/updates/inventory?cached=1');
      expect(res.status).toBe(200);
      const body = res.body as { inventory?: unknown[]; cached?: boolean };
      expect(body.cached).toBe(true);
      expect(Array.isArray(body.inventory)).toBe(true);
    },
    30_000,
  );

  it('apply update without candidate is blocked honestly', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/updates/apply', {
      packageName: 'demo-pkg',
      currentVersion: '1.0.0',
      // no candidateVersion → blocked
    });
    expect(res.status).toBe(422);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      applied?: boolean;
      notes?: string[];
    };
    expect(body.ok).toBe(false);
    expect(body.blocked).toBe(true);
    expect(body.applied).not.toBe(true);
    expectHonestOps({
      ok: false,
      blocked: true,
      notes: body.notes,
    });
  });

  it('rejects unauthenticated apply', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/updates/apply',
      { packageName: 'x', candidateVersion: '2' },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('GET updates/self is honest about channel check', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/updates/self');
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      currentVersion?: string;
      ok?: boolean;
      notes?: string[];
      checked?: boolean;
      updateAvailable?: boolean;
    };
    expect(body.currentVersion).toBeTruthy();
    // Must not invent a silent success without notes/ok field
    expect(typeof body.ok === 'boolean' || Array.isArray(body.notes)).toBe(true);
  });

  it('apply with candidate but no EXECUTE is honest (not applied)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/updates/apply', {
      packageName: 'curl',
      currentVersion: '1.0.0',
      candidateVersion: '1.0.1',
      risk: 'low',
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      applied?: boolean;
      apply_status?: string;
      requiresExecute?: boolean;
      notes?: string[];
    };
    expect(body.applied).not.toBe(true);
    expect(body.apply_status).not.toBe('applied');
    expect(typeof body.ok).toBe('boolean');
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      requiresExecute: body.requiresExecute,
      notes: body.notes,
    });
  });

  it('same current/candidate is blocked honestly', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/updates/apply', {
      packageName: 'demo-pkg',
      currentVersion: '2.0.0',
      candidateVersion: '2.0.0',
    });
    expect(res.status).toBe(422);
    const body = res.body as { ok?: boolean; blocked?: boolean; applied?: boolean };
    expect(body.ok).toBe(false);
    expect(body.blocked).toBe(true);
    expect(body.applied).not.toBe(true);
  });

  it('inventory live + cached + refresh with osv', async () => {
    ts = await startTestServer();
    stubHostInventory(ts);
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes('api.osv.dev')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ vulns: [] }),
          text: async () => '{}',
        } as Response;
      }
      return origFetch(input as never, init);
    }) as typeof fetch;
    // seed cache
    ts.ctx.settings.setJson('last_inventory', {
      at: new Date().toISOString(),
      count: 2,
      upgradable: 1,
      meta: { upgradableCount: 1 },
      sample: [{ name: 'curl', version: '1.0' }],
      items: [
        { name: 'curl', version: '1.0', packageName: 'curl', upgradable: true },
        { name: 'bash', version: '5.0', packageName: 'bash', upgradable: false },
      ],
      advice: [
        {
          packageName: 'curl',
          risk: 'medium',
          candidateVersion: '1.1',
          currentVersion: '1.0',
          needsApproval: true,
        },
      ],
    });

    const cached = await apiJson(
      ts,
      'GET',
      '/api/v1/updates/inventory?cached=1&risk=medium&upgradable=1',
    );
    expect(cached.status).toBe(200);
    expect((cached.body as { cached?: boolean }).cached).toBe(true);
    expect(Array.isArray((cached.body as { inventory?: unknown[] }).inventory)).toBe(true);

    const live = await apiJson(ts, 'GET', '/api/v1/updates/inventory');
    expect(live.status).toBeLessThan(500);
    expect(live.status).toBeGreaterThanOrEqual(200);

    const refresh = await apiJson(ts, 'POST', '/api/v1/updates/inventory/refresh', {
      osv: true,
      limit: 3,
    });
    expect(refresh.status).toBe(200);
    expect(Array.isArray((refresh.body as { inventory?: unknown[] }).inventory)).toBe(true);
    expect(Array.isArray((refresh.body as { advice?: unknown[] }).advice)).toBe(true);

    try {
      const refreshPlain = await apiJson(ts, 'POST', '/api/v1/updates/inventory/refresh', {
        osv: false,
      });
      expect(refreshPlain.status).toBe(200);
    } finally {
      globalThis.fetch = origFetch;
    }
  }, 180_000);

  it('apply-batch empty packages is blocked honestly', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/updates/apply-batch', {
      packages: [],
      confirmHighRisk: true,
    });
    expect(res.status).toBe(422);
    const body = res.body as { ok?: boolean; results?: unknown[] };
    expect(body.ok).toBe(false);
    expect(Array.isArray(body.results)).toBe(true);
  });
});
