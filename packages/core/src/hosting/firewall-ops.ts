/**
 * UFW deep operations — port policy / permanent deny.
 * Distinct from fail2ban (log-driven temporary bans) and Defense Center (orchestration).
 */

import type { HostExecutor } from '../host/executor.js';

export type UfwRule = {
  num?: number;
  action: string;
  direction?: string;
  to?: string;
  from?: string;
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
  if (!installed) return '未安裝';
  const a = (active || '').toLowerCase();
  if (a.includes('need to be root') || a.includes('error')) {
    return isRoot ? '讀取失敗' : '需 root 讀取';
  }
  if (a === 'active') return '啟用中';
  if (a === 'inactive') return '已關閉';
  return active || '未知';
}

/** Parse `ufw status numbered` lines into structured rules. */
export function parseUfwNumbered(lines: string[]): UfwRule[] {
  const out: UfwRule[] = [];
  for (const line of lines) {
    const t = line.trim();
    // [ 1] 22/tcp                     ALLOW IN    Anywhere
    // [ 3] Anywhere                   DENY IN     203.0.113.10
    const m = t.match(
      /^\[\s*(\d+)\]\s+(.+?)\s+(ALLOW|DENY|REJECT|LIMIT)\s+(IN|OUT)?\s*(.*)$/i,
    );
    if (m) {
      out.push({
        num: Number(m[1]),
        to: m[2].trim(),
        action: m[3].toUpperCase(),
        direction: (m[4] || 'IN').toUpperCase(),
        from: (m[5] || '').trim() || 'Anywhere',
        raw: t,
      });
      continue;
    }
    if (/ALLOW|DENY|REJECT/i.test(t)) {
      out.push({ action: '?', raw: t });
    }
  }
  return out;
}

export function extractDenyFromIps(rules: UfwRule[]): string[] {
  const ips: string[] = [];
  for (const r of rules) {
    if (!/^DENY/i.test(r.action)) continue;
    const from = (r.from || '').replace(/\s*\(v6\)\s*/i, '').trim();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(from) || from.includes(':')) {
      ips.push(from);
    }
  }
  return [...new Set(ips)];
}

export async function probeFirewallDeep(host: HostExecutor): Promise<FirewallDeepStatus> {
  const notes: string[] = [];
  const installed =
    host.pathExists('/usr/sbin/ufw') ||
    host.pathExists('/usr/bin/ufw') ||
    (await host
      .runCommand(['bash', '-c', 'command -v ufw >/dev/null && echo yes || echo no'], {
        timeoutMs: 3_000,
      })
      .then((r) => (r.stdout || '').trim() === 'yes')
      .catch(() => false));

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
      notes.push('無法讀取 numbered 規則');
    }
  } else {
    notes.push('UFW 未安裝');
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
    notes,
  };
}

function needExec(host: HostExecutor): { ok: false; blocked: true; notes: string[] } | null {
  if (!host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      notes: ['無法變更 UFW：需 YSK_EXECUTE=1'],
    };
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
          ? '已啟用 UFW'
          : `enable 失敗：${(r.stderr || r.stdout || '').slice(0, 300)}`,
      ],
    };
  }
  const r = await host.runCommand(['ufw', 'disable'], { timeoutMs: 15_000 });
  return {
    ok: r.exitCode === 0,
    notes: [
      r.exitCode === 0
        ? '已停用 UFW（警告：主機埠將直接暴露）'
        : `disable 失敗：${(r.stderr || r.stdout || '').slice(0, 300)}`,
    ],
  };
}

export async function firewallDenyIp(
  host: HostExecutor,
  ip: string,
): Promise<{ ok: boolean; notes: string[]; blocked?: boolean }> {
  const block = needExec(host);
  if (block) return block;
  const safe = ip.trim();
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(safe) && !safe.includes(':')) {
    return { ok: false, notes: ['無效 IP'] };
  }
  const r = await host.runCommand(['ufw', 'deny', 'from', safe], { timeoutMs: 12_000 });
  return {
    ok: r.exitCode === 0,
    notes: [
      r.exitCode === 0
        ? `UFW DENY from ${safe}（永久規則，直至手動刪）`
        : `deny 失敗：${(r.stderr || r.stdout || '').slice(0, 300)}`,
    ],
  };
}

export async function firewallDeleteDenyIp(
  host: HostExecutor,
  ip: string,
): Promise<{ ok: boolean; notes: string[]; blocked?: boolean }> {
  const block = needExec(host);
  if (block) return block;
  const safe = ip.trim();
  const r = await host.runCommand(['ufw', 'delete', 'deny', 'from', safe], {
    timeoutMs: 12_000,
  });
  return {
    ok: r.exitCode === 0,
    notes: [
      r.exitCode === 0
        ? `已刪 UFW DENY ${safe}`
        : `delete 失敗：${(r.stderr || r.stdout || '').slice(0, 300)}`,
    ],
  };
}

export async function firewallDeleteRuleNumber(
  host: HostExecutor,
  num: number,
): Promise<{ ok: boolean; notes: string[]; blocked?: boolean }> {
  const block = needExec(host);
  if (block) return block;
  if (!Number.isInteger(num) || num < 1 || num > 999) {
    return { ok: false, notes: ['無效規則編號'] };
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
        ? `已刪規則 #${num}`
        : `刪 #${num} 失敗：${(r.stderr || r.stdout || '').slice(0, 300)}`,
    ],
  };
}

export async function firewallAllowPort(
  host: HostExecutor,
  port: number,
  proto: 'tcp' | 'udp' = 'tcp',
): Promise<{ ok: boolean; notes: string[]; blocked?: boolean }> {
  const block = needExec(host);
  if (block) return block;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, notes: ['無效埠'] };
  }
  const r = await host.runCommand(['ufw', 'allow', `${port}/${proto}`], { timeoutMs: 12_000 });
  return {
    ok: r.exitCode === 0,
    notes: [
      r.exitCode === 0
        ? `已允許 ${port}/${proto}`
        : `allow 失敗：${(r.stderr || r.stdout || '').slice(0, 300)}`,
    ],
  };
}

/** Hosting-oriented quick profiles (ports only — not fail2ban). */
export const FIREWALL_PROFILES = {
  web: {
    id: 'web',
    label: 'Web 主機',
    short: 'SSH + 80/443',
    allowSmtp: false,
    extraTcpPorts: [] as number[],
  },
  mail: {
    id: 'mail',
    label: 'Web + 郵件',
    short: 'SSH + Web + SMTP/IMAP',
    allowSmtp: true,
    extraTcpPorts: [] as number[],
  },
  ftps: {
    id: 'ftps',
    label: 'Web + FTPS',
    short: '另開 21 與 PASV 段',
    allowSmtp: false,
    extraTcpPorts: [21, ...range(30000, 30100)],
  },
} as const;

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let p = a; p <= b && out.length < 40; p++) out.push(p);
  return out;
}
