/**
 * Mutating API routes → minimum capability (single source for server enforce).
 * First matching rule wins. Unlisted mutating routes are not auto-gated here
 * (handlers may still check explicitly; fail-closed for unknown is optional later).
 */

import type { CapabilityId } from './capabilities.js';

export type RouteCapRule = {
  methods: ReadonlyArray<'POST' | 'PUT' | 'PATCH' | 'DELETE'>;
  /** Full path match (no query). */
  pattern: RegExp;
  cap: CapabilityId;
  /** If set, any listed cap satisfies the mutating gate. */
  anyOf?: readonly CapabilityId[];
  /** Optional human note for docs / tests */
  note?: string;
};

/**
 * Critical write / destructive / privilege paths.
 * Order: more specific patterns before broad ones.
 */
export const MUTATING_ROUTE_CAP_RULES: readonly RouteCapRule[] = [
  // —— Privilege (also enforced in handlers) ——
  { methods: ['POST', 'PATCH', 'DELETE'], pattern: /^\/api\/v1\/users(\/|$)/, cap: 'users.manage' },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/users\/[^/]+\/impersonate$/,
    cap: 'users.impersonate',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/packages(\/|$)/,
    cap: 'packages.manage',
  },
  { methods: ['PUT', 'POST'], pattern: /^\/api\/v1\/rbac\//, cap: 'rbac.policy' },
  { methods: ['POST'], pattern: /^\/api\/v1\/settings\/security$/, cap: 'security.policy' },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/settings\/host-browse$/,
    cap: 'network.browse',
    note: 'host browse panel settings (engine / chrome path)',
  },
  { methods: ['POST'], pattern: /^\/api\/v1\/settings\//, cap: 'settings.system' },

  // —— Destructive ——
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/backups\/restore$/,
    cap: 'backups.restore',
    note: 'tar restore',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/backups\/restic\/restore$/,
    cap: 'backups.restore',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/backups\/control-plane\/restore$/,
    cap: 'backups.restore',
    note: 'control-plane store restore',
  },
  {
    methods: ['DELETE'],
    pattern: /^\/api\/v1\/projects\/[^/]+$/,
    cap: 'projects.delete',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/validators\/[^/]+\/clear$/,
    cap: 'validators.wipe',
    note: 'wipe chain data',
  },
  {
    methods: ['POST', 'PATCH', 'PUT', 'DELETE'],
    pattern: /^\/api\/v1\/validators(\/|$)/,
    cap: 'validators.manage',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/docker\/(prune|volumes\/[^/]+\/remove|images\/remove|containers\/[^/]+\/remove)$/,
    cap: 'docker.wipe',
    note: 'docker destructive prune / remove',
  },
  {
    methods: ['POST', 'PATCH', 'PUT', 'DELETE'],
    pattern: /^\/api\/v1\/docker(\/|$)/,
    cap: 'docker.manage',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/system\/firewall\/(enable|deny|delete-deny|delete-rule)$/,
    cap: 'firewall.flush',
    note: 'high-impact firewall mutations',
  },
  {
    methods: ['DELETE'],
    pattern: /^\/api\/v1\/resources\/(mysql|mariadb|postgres)\/(databases|users)\//,
    cap: 'db.drop',
  },
  {
    methods: ['DELETE'],
    pattern: /^\/api\/v1\/email\/domains\/[^/]+\/mailboxes\//,
    cap: 'mail.write',
  },

  // —— Write-high ——
  { methods: ['POST'], pattern: /^\/api\/v1\/updates\/apply$/, cap: 'updates.apply' },
  { methods: ['POST'], pattern: /^\/api\/v1\/updates\/apply-batch$/, cap: 'updates.apply' },
  { methods: ['POST'], pattern: /^\/api\/v1\/updates\/self\/apply$/, cap: 'updates.apply' },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/system\/services\/lifecycle$/,
    cap: 'services.control',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/system\/.*\/(start|stop|restart|reload)$/,
    cap: 'services.control',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/backups\/(run-all|restic\/run|schedule|control-plane|remote\/test)$/,
    cap: 'backups.run',
  },
  { methods: ['POST'], pattern: /^\/api\/v1\/backups\/settings$/, cap: 'backups.run' },
  { methods: ['DELETE'], pattern: /^\/api\/v1\/backups$/, cap: 'backups.run' },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/system\/firewall\/(apply|allow-port)$/,
    cap: 'firewall.edit',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/hosting\/firewall\//,
    cap: 'firewall.edit',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/system\/fail2ban\//,
    cap: 'firewall.edit',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/dns\/.*\/(apply|reload|push|dnssec)/,
    cap: 'dns.apply',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/dns\/(zones|records)/,
    cap: 'dns.apply',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/hosting\/dns\//,
    cap: 'dns.apply',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/ssl\/(issue|renew|apply)/,
    cap: 'ssl.issue',
  },
  { methods: ['POST'], pattern: /^\/api\/v1\/system\/ssl\/apply$/, cap: 'ssl.issue' },
  { methods: ['POST'], pattern: /^\/api\/v1\/ssl\/upload$/, cap: 'ssl.upload' },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/projects\/[^/]+\/publish-nginx$/,
    cap: 'publish.apply',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/hosting\/nginx\/sync$/,
    cap: 'publish.apply',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/system\/email\/apply$/,
    cap: 'mail.apply',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/email\/(bootstrap|webmail\/apply|dovecot-passdb|queue\/flush)/,
    cap: 'mail.apply',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/system\/db\/(mysql|mariadb|postgres|redis)\/console\/apply$/,
    cap: 'mysql.console.write',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/system\/(php|db)\/.*\/(apply|settings\/apply)$/,
    cap: 'runtime.tuning',
  },
  {
    methods: ['POST', 'PUT'],
    pattern: /^\/api\/v1\/hosting\/(php|runtimes)\//,
    cap: 'runtime.tuning',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/defense\//,
    cap: 'firewall.edit',
  },

  // —— Write-low ——
  { methods: ['POST'], pattern: /^\/api\/v1\/projects$/, cap: 'projects.write' },
  { methods: ['POST'], pattern: /^\/api\/v1\/wizard\/create$/, cap: 'projects.write' },
  {
    methods: ['POST', 'PATCH'],
    pattern: /^\/api\/v1\/projects\/[^/]+/,
    cap: 'projects.write',
  },
  {
    methods: ['POST', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/email\/domains/,
    cap: 'mail.write',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/hosting\/db\/.*provision$/,
    cap: 'db.write',
  },
  {
    methods: ['POST', 'PUT', 'PATCH'],
    pattern: /^\/api\/v1\/resources\/(mysql|mariadb|postgres|redis)\//,
    cap: 'db.write',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/cron/,
    cap: 'cron.manage',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/files\//,
    cap: 'files.project',
  },
  // resources / CDN / agents / tools / SSL residual
  {
    methods: ['DELETE'],
    pattern: /^\/api\/v1\/resources\//,
    cap: 'db.drop',
  },
  {
    methods: ['POST', 'PUT', 'PATCH'],
    pattern: /^\/api\/v1\/cdn\//,
    cap: 'publish.apply',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/ssl\//,
    cap: 'ssl.issue',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/agents\//,
    cap: 'runtime.tuning',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/tools\/execute$/,
    cap: 'services.control',
    note: 'tool execute baseline; finer RBAC still in tool-executor',
  },
  {
    methods: ['POST', 'DELETE'],
    pattern: /^\/api\/v1\/auth\/api-keys/,
    cap: 'security.api_keys.admin',
  },

  // —— B1 audit fill: previously unlisted mutating surfaces ——
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/approvals\//,
    cap: 'approvals.respond',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/db\//,
    cap: 'db.write',
    note: 'db clusters / temp users / adminer — drop still matched earlier DELETE rules',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/vpn\//,
    cap: 'network.vpn',
    note: 'VPN server/client mutations',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/vnc\//,
    cap: 'network.vnc',
    note: 'VNC server/client mutations',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/network\//,
    cap: 'settings.system',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/hosting\//,
    cap: 'projects.write',
    note: 'generic hosting mutations; specific dns/nginx rules above win first',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/fleet\//,
    cap: 'services.control',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/migrate/,
    cap: 'settings.system',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/ai\//,
    cap: 'settings.system',
    note: 'AI task / RCA mutations — privilege for control-plane AI',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/ssh\//,
    cap: 'security.policy',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/terminal\//,
    cap: 'settings.system',
    anyOf: ['settings.system', 'services.control'],
    note: 'browser terminal tickets — privilege shell access',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/host-browse\//,
    cap: 'network.browse',
    note: 'host-mediated proxy browser sessions',
  },
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/sftp\//,
    cap: 'files.project',
  },
  {
    methods: ['POST', 'DELETE'],
    pattern: /^\/api\/v1\/logs\//,
    cap: 'logs.purge',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/updates\//,
    cap: 'updates.apply',
    note: 'inventory refresh is POST; apply already matched more specific',
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/system\//,
    cap: 'settings.system',
    note: 'fallback for unlisted system mutations',
  },
  /**
   * Last-resort: any other mutating /api/v1/* not listed above.
   * Fail-closed for unknown write surface (agents / future routes must add a rule).
   * Public auth paths are skipped in enforceMutatingRouteCaps.
   */
  {
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\//,
    cap: 'settings.system',
    note: 'B1 fail-closed fallback — prefer a specific rule above',
  },
];

/** Resolve capability for a mutating request, or null if no rule. */
export function matchMutatingRouteCap(
  method: string,
  pathname: string,
): CapabilityId | null {
  const m = method.toUpperCase();
  if (m !== 'POST' && m !== 'PUT' && m !== 'PATCH' && m !== 'DELETE') {
    return null;
  }
  // Impersonate is POST under users — must win over users.manage blanket
  if (m === 'POST' && /^\/api\/v1\/users\/[^/]+\/impersonate$/.test(pathname)) {
    return 'users.impersonate';
  }
  // Project delete must win over projects.write blanket
  if (m === 'DELETE' && /^\/api\/v1\/projects\/[^/]+$/.test(pathname)) {
    return 'projects.delete';
  }
  // Publish nginx is write-high, not mere projects.write
  if (m === 'POST' && /^\/api\/v1\/projects\/[^/]+\/publish-nginx$/.test(pathname)) {
    return 'publish.apply';
  }
  // SSL upload is write-low (before generic ssl.issue)
  if (m === 'POST' && pathname === '/api/v1/ssl/upload') {
    return 'ssl.upload';
  }
  for (const rule of MUTATING_ROUTE_CAP_RULES) {
    if (!(rule.methods as readonly string[]).includes(m)) continue;
    if (rule.pattern.test(pathname)) return rule.cap;
  }
  return null;
}

/** Caps that satisfy a mutating rule (any-of), or null if no rule. */
export function matchMutatingRouteAnyOf(
  method: string,
  pathname: string,
): CapabilityId[] | null {
  const m = method.toUpperCase();
  if (m !== 'POST' && m !== 'PUT' && m !== 'PATCH' && m !== 'DELETE') {
    return null;
  }
  const cap = matchMutatingRouteCap(m, pathname);
  if (!cap) return null;
  for (const rule of MUTATING_ROUTE_CAP_RULES) {
    if (!(rule.methods as readonly string[]).includes(m)) continue;
    if (rule.pattern.test(pathname)) {
      if (rule.anyOf?.length) return [...rule.anyOf];
      return [rule.cap];
    }
  }
  return [cap];
}

/**
 * Authenticated GET inventory → any-of capabilities (viewer factory read caps).
 * Unlisted GETs stay session-only. Agent poller / public / self-service skipped in enforce.
 */
export type GetRouteCapRule = {
  pattern: RegExp;
  caps: readonly CapabilityId[];
  note?: string;
};

export const GET_ROUTE_CAP_RULES: readonly GetRouteCapRule[] = [
  { pattern: /^\/api\/v1\/users(\/|$)/, caps: ['users.manage', 'rbac.policy'] },
  { pattern: /^\/api\/v1\/rbac(\/|$)/, caps: ['rbac.policy', 'users.manage'] },
  { pattern: /^\/api\/v1\/audit(\/|$)/, caps: ['audit.export', 'settings.system'] },
  { pattern: /^\/api\/v1\/email(\/|$)/, caps: ['mail.read', 'mail.write', 'mail.apply'] },
  { pattern: /^\/api\/v1\/ssl(\/|$)/, caps: ['ssl.read', 'ssl.upload', 'ssl.issue'] },
  { pattern: /^\/api\/v1\/backups(\/|$)/, caps: ['backups.read', 'backups.run', 'backups.restore'] },
  { pattern: /^\/api\/v1\/projects(\/|$)/, caps: ['projects.read', 'projects.write'] },
  { pattern: /^\/api\/v1\/dns(\/|$)/, caps: ['dns.read', 'dns.apply'] },
  { pattern: /^\/api\/v1\/cdn(\/|$)/, caps: ['projects.read', 'publish.apply'] },
  { pattern: /^\/api\/v1\/logs(\/|$)/, caps: ['logs.read', 'logs.purge'] },
  { pattern: /^\/api\/v1\/metrics(\/|$)/, caps: ['metrics.read'] },
  { pattern: /^\/api\/v1\/updates(\/|$)/, caps: ['updates.read', 'updates.apply'] },
  {
    pattern: /^\/api\/v1\/validators(\/|$)/,
    caps: ['validators.read', 'validators.manage', 'validators.wipe'],
  },
  {
    pattern: /^\/api\/v1\/docker(\/|$)/,
    caps: ['docker.read', 'docker.manage', 'docker.wipe'],
  },
  { pattern: /^\/api\/v1\/defense(\/|$)/, caps: ['firewall.read', 'firewall.edit', 'firewall.flush'] },
  {
    pattern: /^\/api\/v1\/system\/firewall/,
    caps: ['firewall.read', 'firewall.edit', 'firewall.flush'],
  },
  {
    pattern: /^\/api\/v1\/host-browse(\/|$)/,
    caps: ['network.browse'],
  },
  {
    pattern: /^\/api\/v1\/terminal(\/|$)/,
    caps: ['settings.system', 'services.control'],
  },
  {
    pattern: /^\/api\/v1\/ssh(\/|$)/,
    caps: ['settings.system', 'security.policy', 'backups.run'],
  },
  {
    pattern: /^\/api\/v1\/fleet(\/|$)/,
    caps: ['services.read', 'services.control', 'settings.system', 'runtime.tuning'],
  },
  {
    pattern: /^\/api\/v1\/settings\/llm$/,
    caps: ['settings.system'],
  },
  {
    pattern: /^\/api\/v1\/settings\/host-browse$/,
    caps: ['network.browse'],
  },
  {
    pattern: /^\/api\/v1\/settings\/security$/,
    caps: ['security.policy', 'users.self'],
  },
];

/** Resolve any-of caps for a GET, or null if no inventory rule. */
export function matchGetRouteCaps(pathname: string): readonly CapabilityId[] | null {
  for (const rule of GET_ROUTE_CAP_RULES) {
    if (rule.pattern.test(pathname)) return rule.caps;
  }
  return null;
}

/**
 * Nav / feature key → capabilities required to *see* the item (any-of).
 * Empty / missing → any authenticated user (read surfaces).
 */
export const FEATURE_NAV_CAPS: Readonly<Record<string, readonly CapabilityId[]>> = {
  users: ['users.manage', 'packages.manage', 'rbac.policy'],
  backups: ['backups.read', 'backups.run', 'backups.restore'],
  updates: ['updates.read', 'updates.apply'],
  services: ['services.read', 'services.control'],
  protection: ['firewall.read', 'firewall.edit', 'firewall.flush'],
  security: ['users.self', 'security.policy', 'security.api_keys.admin'],
  // nested defense tools
  firewall: ['firewall.read', 'firewall.edit', 'firewall.flush'],
  fail2ban: ['firewall.read', 'firewall.edit', 'firewall.flush'],
  // system admin-ish
  systemd: ['services.control', 'settings.system'],
  migrate: ['settings.system', 'backups.restore'],
  agents: ['services.read', 'services.control', 'runtime.tuning'],
  cdn: ['publish.apply', 'projects.read'],
  rbac: ['rbac.policy', 'users.manage'],
  terminal: ['settings.system', 'services.control'],
  hostBrowse: ['network.browse'],
  vpn: ['network.vpn'],
  vnc: ['network.vnc'],
  validators: ['validators.read', 'validators.manage', 'validators.wipe'],
  docker: ['docker.read', 'docker.manage', 'docker.wipe'],
};

/** Path prefix → any-of caps (for SPA route guard). Longer prefixes win. */
export const PATH_CAP_GUARDS: ReadonlyArray<{
  prefix: string;
  caps: readonly CapabilityId[];
}> = [
  { prefix: '/users', caps: ['users.manage', 'packages.manage', 'rbac.policy'] },
  { prefix: '/backups', caps: ['backups.read', 'backups.run', 'backups.restore'] },
  { prefix: '/updates', caps: ['updates.read', 'updates.apply'] },
  { prefix: '/services', caps: ['services.read', 'services.control'] },
  {
    prefix: '/protection/firewall',
    caps: ['firewall.read', 'firewall.edit', 'firewall.flush'],
  },
  {
    prefix: '/protection/fail2ban',
    caps: ['firewall.read', 'firewall.edit', 'firewall.flush'],
  },
  {
    prefix: '/protection',
    caps: ['firewall.read', 'firewall.edit', 'firewall.flush'],
  },
  { prefix: '/system/migrate', caps: ['settings.system', 'backups.restore'] },
  { prefix: '/system/unit', caps: ['services.control', 'settings.system'] },
  { prefix: '/system/readiness', caps: ['dashboard.read', 'settings.system'] },
  { prefix: '/terminal', caps: ['settings.system', 'services.control'] },
  { prefix: '/browse', caps: ['network.browse'] },
  { prefix: '/vpn', caps: ['network.vpn'] },
  { prefix: '/vnc', caps: ['network.vnc'] },
  {
    prefix: '/validators',
    caps: ['validators.read', 'validators.manage', 'validators.wipe'],
  },
  {
    prefix: '/docker',
    caps: ['docker.read', 'docker.manage', 'docker.wipe'],
  },
  { prefix: '/agents', caps: ['services.read', 'services.control', 'runtime.tuning'] },
  { prefix: '/cdn', caps: ['publish.apply', 'projects.read'] },
];

/** True if actor may see a feature nav item. */
export function canSeeFeature(
  featureKey: string,
  effective: readonly CapabilityId[] | Set<string>,
): boolean {
  const need = FEATURE_NAV_CAPS[featureKey];
  if (!need || need.length === 0) return true;
  const has = (id: string) =>
    effective instanceof Set ? effective.has(id) : effective.includes(id as CapabilityId);
  return need.some((c) => has(c));
}

/** SPA path guard — null means no special gate. */
export function capsRequiredForPath(pathname: string): readonly CapabilityId[] | null {
  let best: (typeof PATH_CAP_GUARDS)[number] | null = null;
  for (const g of PATH_CAP_GUARDS) {
    if (pathname === g.prefix || pathname.startsWith(`${g.prefix}/`)) {
      if (!best || g.prefix.length > best.prefix.length) best = g;
    }
  }
  return best?.caps ?? null;
}

export function canAccessPath(
  pathname: string,
  effective: readonly CapabilityId[] | Set<string>,
): boolean {
  const need = capsRequiredForPath(pathname);
  if (!need) return true;
  const has = (id: string) =>
    effective instanceof Set ? effective.has(id) : effective.includes(id as CapabilityId);
  return need.some((c) => has(c));
}
