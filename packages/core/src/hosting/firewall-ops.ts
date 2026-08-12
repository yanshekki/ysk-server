import { tl } from 'ysk-server-shared';
/**
 * UFW deep operations — port policy / permanent deny.
 * Distinct from fail2ban (log-driven temporary bans) and Defense Center (orchestration).
 */

import type { HostExecutor } from '../host/executor.js';
import { isValidIp, normalizeIp, normalizeIpOrCidr } from '../net/ip.js';
import { HostSoftwareProbe } from './software-probe/index.js';

export type UfwRule = {
  num?: number;
  action: string;
  direction?: string;
  to?: string;
  from?: string;
  /** UFW comment after `#` when present */
  comment?: string;
  raw: string;
};

export type FirewallDeepStatus = {
  installed: boolean;
  active: string;
  activeLabel: string;
  statusText: string;
  numberedRules: string[];
  rules: UfwRule[];
  denyFromIps: string[];
  allowCount: number;
  denyCount: number;
  defaultIncoming?: string;
  defaultOutgoing?: string;
  executeEnabled: boolean;
  isRoot: boolean;
  notes: string[];
};

function humanActive(active: string, installed: boolean, isRoot: boolean): string {
  if (!installed) return tl('notes.notInstalled');
  const a = (active || '').toLowerCase();
  if (a.includes('need to be root') || a.includes('error')) {
    return isRoot ? tl('notes.readFailed') : tl('notes.tpl.needRootRead');
  }
  if (a === 'active') return tl('notes.auto.n0623');
  if (a === 'inactive') return tl('notes.state.closed');
  return active || tl('notes.unknown');
}

/** Extract trailing `# comment` from a UFW status line. */
export function extractUfwComment(raw: string): string | undefined {
  const m = String(raw ?? '').match(/#\s*(.+?)\s*$/);
  if (!m) return undefined;
  const c = m[1]!.trim().replace(/^['"]|['"]$/g, '');
  return c || undefined;
}

/** Parse `ufw status numbered` lines into structured rules. */
export function parseUfwNumbered(lines: string[]): UfwRule[] {
  const out: UfwRule[] = [];
  for (const line of lines) {
    const t = line.trim();
    // [ 1] 22/tcp                     ALLOW IN    Anywhere
    // [ 3] Anywhere                   DENY IN     203.0.113.10
    // [ 5] 80/tcp                     ALLOW IN    Anywhere                   # ysk-svc:nginx:http
    const m = t.match(
      /^\[\s*(\d+)\]\s+(.+?)\s+(ALLOW|DENY|REJECT|LIMIT)\s+(IN|OUT)?\s*(.*)$/i,
    );
    if (m) {
      const rest = (m[5] || '').trim() || 'Anywhere';
      const comment = extractUfwComment(rest) ?? extractUfwComment(t);
      const from = rest.replace(/#\s*.+$/, '').trim() || 'Anywhere';
      out.push({
        num: Number(m[1]),
        to: m[2].trim(),
        action: m[3].toUpperCase(),
        direction: (m[4] || 'IN').toUpperCase(),
        from,
        comment,
        raw: t,
      });
      continue;
    }
    if (/ALLOW|DENY|REJECT/i.test(t)) {
      out.push({ action: '?', comment: extractUfwComment(t), raw: t });
    }
  }
  return out;
}

export function extractDenyFromIps(rules: UfwRule[]): string[] {
  const ips: string[] = [];
  for (const r of rules) {
    if (!/^DENY/i.test(r.action)) continue;
    const from = (r.from || '').replace(/\s*\(v6\)\s*/i, '').trim();
    // UFW may show "Anywhere (v6)" — skip non-IP labels
    const n = normalizeIp(from);
    if (n && isValidIp(n)) ips.push(n);
  }
  return [...new Set(ips)];
}

export async function probeFirewallDeep(host: HostExecutor): Promise<FirewallDeepStatus> {
  const notes: string[] = [];
  const installed = (await new HostSoftwareProbe(host).presence('ufw')).installed;

  let active = 'unknown';
  let statusText = '';
  const numberedRules: string[] = [];
  let defaultIncoming: string | undefined;
  let defaultOutgoing: string | undefined;

  if (installed) {
    try {
      const st = await host.runCommand(['ufw', 'status', 'verbose'], { timeoutMs: 10_000 });
      statusText = `${st.stdout || ''}\n${st.stderr || ''}`.trim();
      const first = statusText.split('\n')[0] || '';
      if (/inactive/i.test(statusText.slice(0, 200))) active = 'inactive';
      else if (/Status:\s*active/i.test(statusText) || /active/i.test(first)) active = 'active';
      else if (/need to be root|ERROR/i.test(statusText)) active = statusText.slice(0, 60);
      else active = first.slice(0, 40) || 'unknown';

      const di = statusText.match(/Default:\s*(\w+)\s*\(incoming\)/i);
      const dout = statusText.match(/,\s*(\w+)\s*\(outgoing\)/i);
      if (di) defaultIncoming = di[1];
      if (dout) defaultOutgoing = dout[1];
    } catch {
      active = 'unknown';
    }
    try {
      const num = await host.runCommand(['ufw', 'status', 'numbered'], { timeoutMs: 10_000 });
      const body = `${num.stdout || ''}`.trim();
      for (const line of body.split('\n')) {
        const t = line.trim();
        if (/^\[\s*\d+\]/.test(t) || /\b(ALLOW|DENY|REJECT)\b/i.test(t)) {
          numberedRules.push(t);
        }
      }
    } catch {
      notes.push(tl('notes.auto.n1184'));
    }
  } else {
    notes.push(tl('notes.auto.n0197'));
  }

  const rules = parseUfwNumbered(numberedRules);
  const denyFromIps = extractDenyFromIps(rules);
  const allowCount = rules.filter((r) => /ALLOW/i.test(r.action)).length;
  const denyCount = rules.filter((r) => /DENY|REJECT/i.test(r.action)).length;

  return {
    installed,
    active,
    activeLabel: humanActive(active, installed, host.isRoot()),
    statusText: statusText.slice(0, 6000),
    numberedRules: numberedRules.slice(0, 120),
    rules: rules.slice(0, 120),
    denyFromIps,
    allowCount,
    denyCount,
    defaultIncoming,
    defaultOutgoing,
    executeEnabled: host.executeEnabled(),
    isRoot: host.isRoot(),
    notes };
}

function needExec(host: HostExecutor): { ok: false; blocked: true; notes: string[] } | null {
  if (!host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      notes: [tl('notes.auto.n1189')] };
  }
  return null;
}

export async function firewallSetEnabled(
  host: HostExecutor,
  enabled: boolean,
): Promise<{ ok: boolean; notes: string[]; blocked?: boolean }> {
  const block = needExec(host);
  if (block) return block;
  if (enabled) {
    const r = await host.runCommand(['ufw', '--force', 'enable'], { timeoutMs: 20_000 });
    return {
      ok: r.exitCode === 0,
      notes: [
        r.exitCode === 0
          ? tl('notes.auto.n0747')
          : tl('notes.auto.t0160', { v0: ((r.stderr || r.stdout || '').slice(0, 300)) }),
      ] };
  }
  const r = await host.runCommand(['ufw', 'disable'], { timeoutMs: 15_000 });
  return {
    ok: r.exitCode === 0,
    notes: [
      r.exitCode === 0
        ? tl('notes.auto.n0732')
        : tl('notes.auto.t0161', { v0: ((r.stderr || r.stdout || '').slice(0, 300)) }),
    ] };
}

export async function firewallDenyIp(
  host: HostExecutor,
  ip: string,
): Promise<{ ok: boolean; notes: string[]; blocked?: boolean }> {
  const block = needExec(host);
  if (block) return block;
  const safe = normalizeIp(ip.trim()) ?? '';
  if (!safe || !isValidIp(safe)) {
    return { ok: false, notes: [tl('notes.invalidIp46')] };
  }
  const r = await host.runCommand(['ufw', 'deny', 'from', safe], { timeoutMs: 12_000 });
  return {
    ok: r.exitCode === 0,
    notes: [
      r.exitCode === 0
        ? tl('notes.auto.t0162', { v0: (safe) })
        : tl('notes.auto.t0163', { v0: ((r.stderr || r.stdout || '').slice(0, 300)) }),
    ] };
}

export async function firewallDeleteDenyIp(
  host: HostExecutor,
  ip: string,
): Promise<{ ok: boolean; notes: string[]; blocked?: boolean }> {
  const block = needExec(host);
  if (block) return block;
  const safe = normalizeIp(ip.trim()) ?? ip.trim();
  if (!safe || !isValidIp(safe)) {
    return { ok: false, notes: [tl('notes.invalidIp46')] };
  }
  const r = await host.runCommand(['ufw', 'delete', 'deny', 'from', safe], {
    timeoutMs: 12_000 });
  return {
    ok: r.exitCode === 0,
    notes: [
      r.exitCode === 0
        ? tl('notes.auto.t0164', { v0: (safe) })
        : tl('notes.auto.t0165', { v0: ((r.stderr || r.stdout || '').slice(0, 300)) }),
    ] };
}

export async function firewallDeleteRuleNumber(
  host: HostExecutor,
  num: number,
): Promise<{ ok: boolean; notes: string[]; blocked?: boolean }> {
  const block = needExec(host);
  if (block) return block;
  if (!Number.isInteger(num) || num < 1 || num > 999) {
    return { ok: false, notes: [tl('notes.auto.n1118')] };
  }
  // ufw delete N is interactive; use yes pipe
  const r = await host.runCommand(
    ['bash', '-c', `yes | ufw delete ${num}`],
    { timeoutMs: 15_000 },
  );
  return {
    ok: r.exitCode === 0,
    notes: [
      r.exitCode === 0
        ? tl('notes.auto.t0166', { v0: (num) })
        : tl('notes.auto.t0167', { v0: (num), v1: ((r.stderr || r.stdout || '').slice(0, 300)) }),
    ] };
}

/**
 * Sanitize optional UFW comment (single-quoted in shell argv — no quotes/newlines).
 */
function sanitizeUfwComment(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const c = String(raw)
    .trim()
    .replace(/['"\\\n\r\t]/g, '')
    .slice(0, 64);
  return c || undefined;
}

/**
 * Allow a single port or UFW range (e.g. 30000:30100 for FTPS PASV).
 * `port` may be number, "80", or "30000:30100".
 * `proto: 'both'` opens TCP and UDP (two UFW rules).
 * Optional `from` (IPv4/IPv6 or CIDR) → `ufw allow from <src> to any port <n> proto <p>`.
 * Empty / omitted `from` → public allow (anywhere).
 * Optional `comment` → UFW `comment '…'` for managed service rules (ysk-svc:…).
 */
export async function firewallAllowPort(
  host: HostExecutor,
  port: number | string,
  proto: 'tcp' | 'udp' | 'both' = 'tcp',
  from?: string,
  comment?: string,
): Promise<{ ok: boolean; notes: string[]; blocked?: boolean }> {
  const block = needExec(host);
  if (block) return block;

  const { parsePortSpec, ufwPortTarget } = await import('ysk-server-shared');
  const raw = typeof port === 'number' ? String(port) : String(port ?? '').trim();
  const spec = parsePortSpec(raw);
  if (!spec) {
    return { ok: false, notes: [tl('notes.auto.n1113')] };
  }
  // Cap range size so a typo does not open the whole stack
  if (spec.to - spec.from > 200) {
    return { ok: false, notes: [tl('notes.auto.n1113')] };
  }
  const label = spec.from === spec.to ? String(spec.from) : `${spec.from}:${spec.to}`;
  const protos: Array<'tcp' | 'udp'> =
    proto === 'both' ? ['tcp', 'udp'] : [proto === 'udp' ? 'udp' : 'tcp'];

  const fromRaw = String(from ?? '').trim();
  let fromNorm: string | null = null;
  if (fromRaw) {
    fromNorm = normalizeIpOrCidr(fromRaw);
    if (!fromNorm) {
      return { ok: false, notes: [tl('notes.invalidIp46')] };
    }
  }

  const cmt = sanitizeUfwComment(comment);

  const notes: string[] = [];
  let okCount = 0;
  let failCount = 0;
  // Idempotent hint: if rule already present, ufw still exits 0 with "Skipping"
  for (const p of protos) {
    const target = ufwPortTarget(raw, p);
    if (!target) {
      return { ok: false, notes: [tl('notes.auto.n1113')] };
    }
    const argv = fromNorm
      ? (['ufw', 'allow', 'from', fromNorm, 'to', 'any', 'port', label, 'proto', p] as string[])
      : (['ufw', 'allow', target] as string[]);
    if (cmt) {
      argv.push('comment', cmt);
    }
    const r = await host.runCommand(argv, { timeoutMs: 12_000 });
    const combined = `${r.stdout || ''}\n${r.stderr || ''}`;
    const fromLabel = fromNorm
      ? tl('notes.firewallAllow.fromLabel', { from: fromNorm })
      : '';
    if (r.exitCode === 0) {
      okCount += 1;
      if (/skipping|existing|already/i.test(combined)) {
        notes.push(
          tl('notes.firewallAllow.already', {
            port: label,
            proto: p,
            from: fromLabel,
          }),
        );
      } else {
        const base = tl('notes.auto.t0168', { v0: label, v1: p });
        notes.push(fromLabel ? `${base}${fromLabel}` : base);
      }
    } else {
      failCount += 1;
      notes.push(tl('notes.auto.t0169', { v0: (r.stderr || r.stdout || '').slice(0, 300) }));
    }
  }
  if (okCount > 0 && failCount > 0) {
    notes.unshift(
      tl('notes.firewallAllow.partial', { ok: okCount, fail: failCount }),
    );
  }
  return { ok: failCount === 0 && okCount > 0, notes };
}

/**
 * Delete all UFW rules whose comment starts with `commentPrefix`
 * (e.g. `ysk-svc:vsftpd:`). Deletes highest rule numbers first.
 */
export async function firewallDeleteByComment(
  host: HostExecutor,
  commentPrefix: string,
): Promise<{ ok: boolean; removed: number; notes: string[]; blocked?: boolean }> {
  const block = needExec(host);
  if (block) return { ...block, removed: 0 };

  const prefix = String(commentPrefix ?? '').trim();
  if (!prefix || prefix.length < 3) {
    return { ok: false, removed: 0, notes: [tl('notes.auto.n1113')] };
  }

  const notes: string[] = [];
  let removed = 0;
  // Multiple passes: deleting renumbers; cap loops
  for (let pass = 0; pass < 40; pass++) {
    const num = await host.runCommand(['ufw', 'status', 'numbered'], { timeoutMs: 10_000 });
    const body = `${num.stdout || ''}`.trim();
    const rules = parseUfwNumbered(
      body
        .split('\n')
        .map((l) => l.trim())
        .filter((t) => /^\[\s*\d+\]/.test(t) || /\b(ALLOW|DENY|REJECT)\b/i.test(t)),
    );
    const match = rules
      .filter((r) => {
        const c = r.comment || extractUfwComment(r.raw) || '';
        return c === prefix || c.startsWith(prefix);
      })
      .filter((r) => typeof r.num === 'number' && r.num! >= 1)
      .sort((a, b) => (b.num ?? 0) - (a.num ?? 0));

    if (match.length === 0) break;

    const rule = match[0]!;
    const del = await host.runCommand(
      ['bash', '-c', `yes | ufw delete ${rule.num}`],
      { timeoutMs: 15_000 },
    );
    if (del.exitCode === 0) {
      removed += 1;
    } else {
      notes.push(
        tl('notes.auto.t0167', {
          v0: rule.num,
          v1: (del.stderr || del.stdout || '').slice(0, 300),
        }),
      );
      break;
    }
  }

  if (removed > 0) {
    notes.unshift(tl('notes.firewallDeleteByComment.removed', { n: removed, prefix }));
  } else if (notes.length === 0) {
    notes.push(tl('notes.firewallDeleteByComment.none', { prefix }));
  }

  return { ok: notes.every((n) => !/fail|error|boom/i.test(n)) || removed > 0, removed, notes };
}

/** Hosting-oriented quick profiles (ports only — not fail2ban). */
export const FIREWALL_PROFILES = {
  web: {
    id: 'web',
    label: tl('notes.auto.n0203'),
    short: 'SSH + 80/443',
    allowSmtp: false,
    extraTcpPorts: [] as number[],
    /** Prefer UFW range specs over expanded port lists */
    extraPortSpecs: [] as string[] },
  mail: {
    id: 'mail',
    label: tl('notes.auto.n0201'),
    short: 'SSH + Web + SMTP/IMAP',
    allowSmtp: true,
    extraTcpPorts: [] as number[],
    extraPortSpecs: [] as string[] },
  ftps: {
    id: 'ftps',
    label: 'Web + FTPS',
    short: tl('notes.auto.n0609'),
    allowSmtp: false,
    extraTcpPorts: [] as number[],
    // One UFW rule for PASV band — not 101 individual allows
    extraPortSpecs: ['21', '990', '30000:30100'] } } as const;
