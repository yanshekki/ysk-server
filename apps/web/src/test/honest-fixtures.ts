/**
 * Honest API shapes for function-coverage hammers.
 * Prefer complete DTOs so page renders do not throw mid-test.
 */

export function nowIso() {
  return new Date().toISOString();
}

export function hostOverview(t = nowIso()) {
  return {
    ok: true,
    identity: {
      hostname: 'ysk',
      prettyHostname: 'YSK Test',
      timezone: 'UTC',
    },
    os: {
      platform: 'linux',
      arch: 'x64',
      release: 'Test OS',
      kernel: '6.0',
    },
    runtime: {
      uptimeSec: 10000,
      loadavg: [0.1, 0.2, 0.3],
      cpus: 4,
      memory: { total: 8e9, free: 4e9, usedRatio: 0.5 },
      node: 'v20.0.0',
      pid: 1,
      uid: 0,
    },
    time: {
      utc: t,
      local: t,
      ntpEnabled: true,
      ntpSynchronized: true,
      timeSource: 'ntp',
    },
    network: { ips: ['10.0.0.5'], interfaces: [], resolvers: ['1.1.1.1'] },
    disks: [{ mount: '/', total: 1e11, used: 5e10, usePct: 50 }],
    power: { pending: null },
    boot: { defaultTarget: 'multi-user.target' },
    caps: {
      executeEnabled: true,
      isRoot: true,
      canPower: true,
      canIdentity: true,
    },
    collectedAt: t,
  };
}

export function readinessReport(t = nowIso()) {
  return {
    product: 'ysk',
    generatedAt: t,
    mode: 'degraded',
    executeEnabled: false,
    isRoot: false,
    score: { ready: 3, degraded: 2, missing: 1, total: 6 },
    productionReady: false,
    summary: ['EXECUTE off'],
    categories: ['security', 'platform'],
    blockers: [
      {
        id: 'execute-policy',
        category: 'security',
        title: 'Execute policy',
        level: 'missing',
        detail: 'off',
        severity: 'critical',
        fixHref: '/system',
        fixHint: 'enable',
      },
    ],
    items: [
      {
        id: 'execute-policy',
        category: 'security',
        title: 'Execute policy',
        level: 'missing',
        detail: 'off',
        severity: 'critical',
        fixHref: '/system',
        fixHint: 'enable YSK_EXECUTE',
      },
      {
        id: 'ssh',
        category: 'security',
        title: 'SSH',
        level: 'ready',
        detail: 'ok',
        severity: 'critical',
      },
      {
        id: 'nginx',
        category: 'platform',
        title: 'Nginx',
        level: 'degraded',
        detail: 'partial',
        severity: 'recommended',
        fixHref: '/nginx',
      },
    ],
    notes: [],
    ok: true,
  };
}

export function suspect(t = nowIso()) {
  return {
    ip: '203.0.113.99',
    score: 80,
    hits: 12,
    reasons: ['scan', 'auth'],
    sources: ['nginx', 'fail2ban'],
    lastSeen: t,
    alreadyBanned: false,
    whitelisted: false,
  };
}

export function backupItem(t = nowIso()) {
  return {
    id: 'b1',
    projectId: 'p1',
    name: 'Demo nightly',
    path: '/var/backups/p1.tgz',
    bytes: 4096,
    mtime: t,
    kind: 'full' as const,
    schedule: '0 2 * * *',
    enabled: true,
    apply_status: 'applied',
  };
}

export function backupsPayload(t = nowIso()) {
  return {
    items: [
      backupItem(t),
      {
        ...backupItem(t),
        id: 'b2',
        projectId: 'p2',
        name: 'Other',
        path: '/var/backups/p2.tgz',
        bytes: 1024,
        kind: 'incremental' as const,
      },
    ],
    lastRun: {
      at: t,
      ok: true,
      results: [
        { projectId: 'p1', ok: true, notes: ['ok'] },
        { projectId: 'p2', ok: false, notes: ['fail'] },
      ],
    },
    snapshots: [
      {
        id: 'snap1',
        time: t,
        tags: ['p1'],
        paths: ['/home'],
        short_id: 'abc',
      },
    ],
    total: 2,
    meta: { total: 2 },
    ok: true,
  };
}

export function aiTask(t = nowIso(), id = 't1', status = 'planned') {
  return {
    id,
    title: 'Task',
    status,
    prompt: 'fix nginx',
    steps: [
      { id: 's1', status: status === 'running' ? 'running' : 'pending', title: 'check' },
      { id: 's2', status: 'pending', title: 'apply' },
    ],
    createdAt: t,
  };
}

export function aiTasksPayload(t = nowIso()) {
  return {
    items: [aiTask(t, 't1', 'planned'), aiTask(t, 't2', 'running')],
    tasks: [aiTask(t, 't1', 'planned'), aiTask(t, 't2', 'running')],
    playbooks: [{ id: 'pb1', name: 'Harden', description: 'd' }],
    total: 2,
    ok: true,
  };
}

export function sshIdentity(t = nowIso()) {
  return {
    id: 'id1',
    name: 'deploy',
    algorithm: 'ed25519',
    purpose: 'panel_outbound',
    publicKey: 'ssh-ed25519 AAAA',
    fingerprint: 'SHA256:abcdefghijklmnopqr',
    fingerprintSha256: 'SHA256:abcdefghijklmnopqr',
    createdAt: t,
    status: 'active',
    binding: { projectId: 'p1', linuxUser: 'demo', homeDir: '/home/ysk/demo' },
  };
}

export function journalUnitsPayload() {
  return {
    items: [
      { unit: 'nginx.service', active: 'active', description: 'Nginx' },
      { unit: 'sshd.service', active: 'active', description: 'SSH' },
      { unit: 'ysk-project-p1.service', active: 'active', description: 'Project p1' },
    ],
  };
}

export function emailDomainBundle(t = nowIso()) {
  return {
    id: 'dom-1',
    domain: 'mail.example.com',
    name: 'mail.example.com',
    apply_status: 'applied',
    health_score: 90,
    status: 'active',
    server_ip: '203.0.113.5',
    records: [
      { type: 'MX', name: '@', value: '10 mail.example.com', ttl: 300 },
      { type: 'TXT', name: '@', value: 'v=spf1 mx -all', ttl: 300 },
    ],
    mailboxes: [{ id: 'm1', local_part: 'postmaster', quotaMb: 100 }],
    aliases: [{ id: 'al1', source: 'info', destinations: ['postmaster@mail.example.com'] }],
    health: { score: 90, maxScore: 100, messages: [] },
    externalTodos: [],
    notes: [],
    items: [
      {
        id: 'dom-1',
        domain: 'mail.example.com',
        apply_status: 'applied',
        health_score: 90,
        server_ip: '203.0.113.5',
      },
    ],
    total: 1,
    meta: { total: 1 },
    ok: true,
  };
}

export function userRow(t = nowIso()) {
  return {
    id: 'u1',
    username: 'admin',
    roles: ['admin'],
    status: 'active',
    suspended: false,
    lastLoginAt: t,
  };
}

export function networkSnapshot(t = nowIso()) {
  return {
    ok: true,
    at: t,
    notes: [],
    backend: {
      hasIp: true,
      networkManager: 'active',
      networkd: 'inactive',
      canPersist: true,
    },
    interfaces: [
      {
        name: 'eth0',
        ifindex: 2,
        operstate: 'UP',
        flags: ['UP', 'BROADCAST'],
        mac: 'aa:bb:cc:dd:ee:ff',
        mtu: 1500,
        isLoopback: false,
        isDefaultEgress: true,
        addrs: [{ family: 'inet' as const, local: '10.0.0.5', prefixlen: 24 }],
        addresses: [{ family: 'inet' as const, local: '10.0.0.5', prefixlen: 24 }],
        stats: { rxBytes: 1e6, txBytes: 2e6, rxPackets: 10, txPackets: 10 },
      },
    ],
    routes: [{ dst: 'default', gateway: '10.0.0.1', dev: 'eth0', protocol: 'static' }],
    caps: { canMutate: true, executeEnabled: true, isRoot: true },
    defaultGateway: '10.0.0.1',
    defaultDev: 'eth0',
    dns: {
      nameservers: ['1.1.1.1'],
      uplinkServers: ['1.1.1.1'],
      search: ['example.com'],
      source: 'static',
      notes: [],
      ignoreAutoDns: true,
      canApply: true,
      mode: 'static' as const,
      connection: 'Wired',
      device: 'eth0',
    },
  };
}

export function cdnDashboard(t = nowIso()) {
  return {
    at: t,
    nodes: {
      total: 1,
      online: 1,
      offline: 0,
      draining: 0,
      unknown: 0,
      byRegion: { local: 1 },
    },
    sites: {
      total: 1,
      byApplyStatus: { applied: 1 },
      rows: [
        {
          id: 's1',
          name: 'cdn.example.com',
          domains: ['cdn.example.com'],
          mode: 'origin_pull',
          strategy: 'multi_a',
          apply_status: 'applied',
          edgeCount: 1,
          edgesApplied: 1,
          onlineEdges: 1,
          managedDnsRecords: 1,
        },
      ],
    },
    cache: [
      {
        siteId: 's1',
        siteName: 'cdn.example.com',
        method: 'nginx',
        hitRatePct: 80,
        hits: 100,
        misses: 20,
        cacheBytes: 1e6,
        notes: [],
      },
    ],
    overallHitRatePct: 80,
    notes: [],
    items: [
      {
        id: 'n1',
        name: 'edge-1',
        host: 'edge.example.com',
        region: 'local',
        roles: ['edge'],
        status: 'online',
        ipv4: '203.0.113.10',
      },
      {
        id: 's1',
        name: 'cdn.example.com',
        domains: ['cdn.example.com'],
        originUrl: 'https://origin.example.com',
        apply_status: 'applied',
        mode: 'origin_pull',
        strategy: 'multi_a',
        edgeIds: ['n1'],
        roles: ['edge'],
      },
    ],
    total: 2,
    meta: { total: 2 },
  };
}

/**
 * URL-aware body for mega catch-all handlers.
 * Returns a specialized payload when the path needs a nested DTO; else null.
 */
export function specializedPayload(url: string, t = nowIso()): unknown | null {
  if (url.includes('/system/host')) return hostOverview(t);
  if (url.includes('/readiness')) return readinessReport(t);
  if (url.includes('/backups') || url.includes('/restic')) return backupsPayload(t);
  if (url.includes('/ai/tasks') || (url.includes('/tasks') && !url.includes('playbook'))) {
    return aiTasksPayload(t);
  }
  if (url.includes('/ai/playbooks') && !url.includes('run')) {
    return { items: [{ id: 'pb1', name: 'Harden', description: 'd' }] };
  }
  if (url.includes('journal/units')) return journalUnitsPayload();
  if (url.includes('/logs/projects') || (url.includes('/logs') && url.includes('projects'))) {
    return {
      items: [
        {
          projectId: 'p1',
          name: 'demo',
          files: [
            { name: 'app.log', path: 'logs/app.log', bytes: 100, previewable: true },
            { name: 'error.log', path: 'logs/error.log', bytes: 50, previewable: true },
          ],
          related: [{ source: 'journal:nginx.service', label: 'Nginx', available: true }],
        },
      ],
    };
  }
  if (url.includes('/api/v1/files') || (url.includes('/files') && !url.includes('log'))) {
    const mt = t;
    return {
      path: '.',
      root: 'public',
      items: [
        {
          name: 'readme.txt',
          path: 'readme.txt',
          type: 'file',
          size: 100,
          mtime: mt,
          mime: 'text/plain',
          favorite: true,
        },
        { name: 'docs', path: 'docs', type: 'dir', size: 0, mtime: mt },
      ],
      usage: { bytes: 100, fileCount: 1, dirCount: 1 },
    };
  }
  if (url.includes('/ssh/identities')) {
    return { ok: true, items: [sshIdentity(t), { ...sshIdentity(t), id: 'id2', name: 'peer', status: 'installed' }] };
  }
  if (url.includes('/email/domains/') || /\/email\/domains\//.test(url)) {
    return emailDomainBundle(t);
  }
  if (url.includes('/users') && !url.includes('roles')) {
    return {
      items: [
        userRow(t),
        { id: 'u2', username: 'ops', roles: ['operator'], status: 'active', suspended: false },
      ],
      total: 2,
      meta: {
        total: 2,
        facets: { role: { admin: 1, operator: 1 }, status: { active: 2, suspended: 0 } },
      },
    };
  }
  if (url.includes('/network') || url.includes('/net/')) return networkSnapshot(t);
  if (url.includes('/cdn/dashboard') || url.includes('/cdn/overview')) return cdnDashboard(t);
  if (url.includes('/cdn/nodes') || (url.includes('/cdn') && url.includes('nodes'))) {
    return {
      items: [
        {
          id: 'n1',
          name: 'edge-1',
          host: 'edge.example.com',
          region: 'local',
          roles: ['edge', 'origin'],
          status: 'online',
          ipv4: '203.0.113.10',
        },
      ],
      total: 1,
      meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
    };
  }
  if (url.includes('/cdn/sites') || (url.includes('/cdn') && url.includes('sites'))) {
    return {
      items: [
        {
          id: 's1',
          name: 'cdn.example.com',
          domains: ['cdn.example.com'],
          originUrl: 'https://origin.example.com',
          apply_status: 'applied',
          mode: 'origin_pull',
          strategy: 'multi_a',
          edgeIds: ['n1'],
          roles: ['edge'],
        },
      ],
      total: 1,
      meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
    };
  }
  if (url.includes('/cdn')) return cdnDashboard(t);
  if (url.includes('/resources/dns') || url.includes('/dns/zones') || url.includes('/dns/records')) {
    return {
      items: [
        {
          id: 'z1',
          name: 'example.com',
          zone: 'example.com',
          apply_status: 'applied',
          serverIp: '203.0.113.10',
          records: [{ id: 'r1', type: 'A', name: '@', value: '1.2.3.4', ttl: 300 }],
        },
      ],
      total: 1,
      meta: { total: 1, page: 1, limit: 50, q: '', filters: {}, order: 'asc' },
    };
  }
  return null;
}

/** Merge specialized fields onto a generic rich body used by hammers. */
export function enrichGenericBody(body: Record<string, unknown>, t = nowIso()): Record<string, unknown> {
  const identity = sshIdentity(t);
  const task = aiTask(t);
  const bak = backupItem(t);
  return {
    ...body,
    ...hostOverview(t),
    score: (body.score as object) ?? { ready: 3, degraded: 2, missing: 1, total: 6 },
    tasks: body.tasks ?? [task],
    items: Array.isArray(body.items)
      ? (body.items as Array<Record<string, unknown>>).map((it) => ({
          algorithm: 'ed25519',
          purpose: 'panel_outbound',
          steps: task.steps,
          ...it,
          roles: Array.isArray(it.roles) ? it.roles : ['edge', 'admin'],
          projectId: typeof it.projectId === 'string' ? it.projectId : 'p1',
          fingerprintSha256:
            typeof it.fingerprintSha256 === 'string'
              ? it.fingerprintSha256
              : identity.fingerprintSha256,
        }))
      : [bak, { ...identity }, task],
    identities: [identity],
    units: [
      { unit: 'nginx.service', active: 'active', description: 'Nginx' },
      { unit: 'sshd.service', active: 'active', description: 'SSH' },
    ],
    records: Array.isArray(body.records)
      ? body.records
      : [{ type: 'MX', name: '@', value: '10 mail', ttl: 300 }],
    missing: Array.isArray(body.missing) ? body.missing : [],
    ready: body.ready ?? true,
  };
}
