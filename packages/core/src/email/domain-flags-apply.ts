import { tl } from 'ysk-server-shared';
/**
 * Apply domain suspend + vacation artifacts to host (Postfix / Dovecot).
 * Never fakes applied without successful host commands.
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import { shellBinExists } from '../hosting/software-probe/index.js';

export type DomainFlagsApplyResult = {
  ok: boolean;
  blocked?: boolean;
  blockMessage?: string;
  apply_status: 'written' | 'applied' | 'partial' | 'blocked';
  notes: string[];
  written: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
};

/**
 * Rebuild aggregate suspend map from all domain SUSPENDED.flag files.
 */
export function rebuildSuspendDomainMap(dataDir: string): {
  path: string;
  domains: string[];
  notes: string[];
} {
  const root = join(dataDir, 'email');
  const outDir = join(dataDir, 'email', 'policy');
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, 'ysk-suspend-domains');
  const domains: string[] = [];
  if (existsSync(root)) {
    for (const name of readdirSync(root)) {
      const flag = join(root, name, 'SUSPENDED.flag');
      if (existsSync(flag)) {
        // domain dir name is the domain
        if (name.includes('.') || name.length > 1) domains.push(name.toLowerCase());
      }
    }
  }
  const body =
    domains.map((d) => `${d} REJECT Domain suspended by YSK`).join('\n') +
    (domains.length ? '\n' : '# no suspended domains\n');
  writeFileSync(path, body, 'utf8');
  return {
    path,
    domains,
    notes: [
      `suspend map: ${path} (${domains.length} domains)`,
      domains.length
        ? `paused: ${domains.join(', ')}`
        : tl('notes.auto.n1120'),
    ],
  };
}

/**
 * Write per-mailbox vacation sieve copies under dataDir (from domain vacation.sieve).
 */
export function writeMailboxVacationCopies(input: {
  dataDir: string;
  domain: string;
  mailboxes: string[]; // local parts
  enabled: boolean;
}): { written: string[]; notes: string[] } {
  const written: string[] = [];
  const notes: string[] = [];
  const domainSieve = join(input.dataDir, 'email', input.domain, 'sieve', 'vacation.sieve');
  if (!existsSync(domainSieve)) {
    notes.push(tl('notes.auto.n1075'));
    return { written, notes };
  }
  const content = readFileSync(domainSieve, 'utf8');
  for (const local of input.mailboxes) {
    const addr = `${local}@${input.domain}`;
    const dir = join(input.dataDir, 'email', 'sieve', addr);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, input.enabled ? 'vacation.sieve' : 'vacation.disabled.sieve');
    writeFileSync(path, content, 'utf8');
    written.push(path);
  }
  if (input.mailboxes.length) {
    notes.push(
      tl('notes.auto.t0065', { v0: (input.mailboxes.length) }),
    );
  } else {
    notes.push(tl('notes.auto.n0628'));
  }
  return { written, notes };
}

/**
 * Install suspend map into Postfix + postmap + ensure recipient restriction + reload.
 */
export async function applySuspendMapToPostfix(input: {
  host: HostExecutor;
  mapPath: string;
}): Promise<{
  ok: boolean;
  notes: string[];
  commandResults: DomainFlagsApplyResult['commandResults'];
}> {
  const notes: string[] = [];
  const commandResults: DomainFlagsApplyResult['commandResults'] = [];
  const sysDir = '/etc/postfix/ysk-server';
  const sysMap = `${sysDir}/ysk-suspend-domains`;

  const steps: Array<{ name: string; argv: string[]; hard?: boolean }> = [
    {
      name: 'mkdir',
      argv: ['mkdir', '-p', sysDir],
      hard: true,
    },
    {
      name: 'cp map',
      argv: ['cp', '-f', input.mapPath, sysMap],
      hard: true,
    },
    {
      name: 'postmap',
      argv: [
        'bash',
        '-c',
        `if ${shellBinExists('postmap')}; then postmap hash:${sysMap} || postmap ${sysMap}; fi`,
      ],
      hard: true,
    },
    {
      name: 'postconf recipient access',
      argv: [
        'bash',
        '-c',
        `grep -q 'ysk-suspend-domains' /etc/postfix/main.cf 2>/dev/null || postconf -e "smtpd_recipient_restrictions=\$smtpd_recipient_restrictions, check_recipient_access hash:${sysMap}"`,
      ],
      hard: true,
    },
    {
      name: 'reload postfix',
      argv: ['bash', '-c', 'systemctl reload postfix 2>&1 || service postfix reload 2>&1'],
      hard: true,
    },
  ];

  for (const step of steps) {
    const r = await input.host.runCommand(step.argv, { timeoutMs: 30_000 });
    commandResults.push({
      argv: step.argv,
      exitCode: r.exitCode,
      stderr: r.stderr,
    });
    if (r.exitCode !== 0) {
      notes.push(tl('notes.tpl.actionFailed', { action: step.name, detail: (r.stderr || r.stdout).slice(0, 200) }));
      if (step.hard) {
        return { ok: false, notes, commandResults };
      }
    } else {
      notes.push(`${step.name} ok`);
    }
  }
  notes.push(tl('notes.auto.n0156'));
  return { ok: true, notes, commandResults };
}

/**
 * Deploy vacation sieve to system vmail paths when present.
 * Looks for /var/vmail, /var/mail/vhosts, or dataDir maildir parents.
 */
export async function applyVacationSieveToSystem(input: {
  host: HostExecutor;
  dataDir: string;
  domain: string;
  mailboxes: string[];
  enabled: boolean;
}): Promise<{
  ok: boolean;
  notes: string[];
  written: string[];
  commandResults: DomainFlagsApplyResult['commandResults'];
}> {
  const notes: string[] = [];
  const written: string[] = [];
  const commandResults: DomainFlagsApplyResult['commandResults'] = [];
  const domainSieve = join(input.dataDir, 'email', input.domain, 'sieve', 'vacation.sieve');
  if (!existsSync(domainSieve)) {
    return {
      ok: false,
      notes: [tl('notes.auto.n1088')],
      written,
      commandResults,
    };
  }

  if (!input.mailboxes.length) {
    notes.push(tl('notes.auto.n1200'));
    return { ok: true, notes, written, commandResults };
  }

  let anyOk = false;
  let anyFail = false;
  for (const local of input.mailboxes) {
    const candidates = [
      `/var/vmail/${input.domain}/${local}/sieve`,
      `/var/mail/vhosts/${input.domain}/${local}/sieve`,
      join(input.dataDir, 'email', input.domain, 'mailboxes', local, 'sieve'),
    ];
    let destDir: string | undefined;
    for (const c of candidates) {
      // Prefer existing mailbox home parent
      const parent = join(c, '..');
      if (existsSync(parent) || c.includes(input.dataDir)) {
        destDir = c;
        break;
      }
    }
    if (!destDir) destDir = candidates[0];

    const destFile = join(
      destDir!,
      input.enabled ? 'vacation.sieve' : 'vacation.disabled.sieve',
    );
    const activeLink = join(destDir!, '.dovecot.sieve');

    const script = [
      `mkdir -p ${JSON.stringify(destDir)}`,
      `cp -f ${JSON.stringify(domainSieve)} ${JSON.stringify(destFile)}`,
      input.enabled
        ? `ln -sfn ${JSON.stringify(destFile)} ${JSON.stringify(activeLink)}`
        : `rm -f ${JSON.stringify(activeLink)}`,
    ].join(' && ');

    const r = await input.host.runCommand(['bash', '-c', script], { timeoutMs: 15_000 });
    commandResults.push({
      argv: ['bash', '-c', script],
      exitCode: r.exitCode,
      stderr: r.stderr,
    });
    if (r.exitCode === 0) {
      anyOk = true;
      written.push(destFile);
      notes.push(
        input.enabled
          ? tl('notes.auto.t0066', { v0: (local), v1: (input.domain) })
          : tl('notes.auto.t0067', { v0: (local), v1: (input.domain) }),
      );
    } else {
      anyFail = true;
      notes.push(
        tl('notes.auto.t0068', { v0: (local), v1: (input.domain), v2: ((r.stderr || r.stdout).slice(0, 120)) }),
      );
    }
  }

  // reload dovecot when present — soft: files already written
  if (anyOk) {
    const reload = await input.host.runCommand(
      ['bash', '-c', 'systemctl reload dovecot 2>&1 || service dovecot reload 2>&1'],
      { timeoutMs: 10_000 },
    );
    commandResults.push({
      argv: ['systemctl', 'reload', 'dovecot'],
      exitCode: reload.exitCode,
      stderr: reload.stderr,
    });
    if (reload.exitCode === 0) notes.push('dovecot reloaded');
    else
      notes.push(
        tl('notes.auto.n0261'),
      );
  }

  return {
    ok: anyOk && !anyFail,
    notes,
    written,
    commandResults,
  };
}

/**
 * Full system apply for suspend map + vacation, after control-plane files exist.
 */
export async function applyDomainFlagsToSystem(input: {
  host: HostExecutor;
  dataDir: string;
  domain: string;
  mailboxes: string[];
  /** Whether suspend was just toggled or domain is suspended */
  suspended: boolean;
  /** Whether vacation should be active */
  vacationEnabled: boolean;
  /** Which parts to apply */
  applySuspend?: boolean;
  applyVacation?: boolean;
}): Promise<DomainFlagsApplyResult> {
  const notes: string[] = [];
  const written: string[] = [];
  const commandResults: DomainFlagsApplyResult['commandResults'] = [];

  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    return {
      ok: false,
      blocked: true,
      blockMessage: tl('notes.auto.n1306'),
      apply_status: 'blocked',
      notes: [tl('notes.auto.n1214')],
      written,
      commandResults,
    };
  }

  let hardFail = false;
  let didWork = false;

  if (input.applySuspend !== false) {
    const map = rebuildSuspendDomainMap(input.dataDir);
    written.push(map.path);
    notes.push(...map.notes);
    // Always refresh map content for current suspended set
    const r = await applySuspendMapToPostfix({ host: input.host, mapPath: map.path });
    notes.push(...r.notes);
    commandResults.push(...r.commandResults);
    if (!r.ok) hardFail = true;
    else didWork = true;
  }

  if (input.applyVacation !== false) {
    const copies = writeMailboxVacationCopies({
      dataDir: input.dataDir,
      domain: input.domain,
      mailboxes: input.mailboxes,
      enabled: input.vacationEnabled,
    });
    written.push(...copies.written);
    notes.push(...copies.notes);

    const vac = await applyVacationSieveToSystem({
      host: input.host,
      dataDir: input.dataDir,
      domain: input.domain,
      mailboxes: input.mailboxes,
      enabled: input.vacationEnabled,
    });
    notes.push(...vac.notes);
    written.push(...vac.written);
    commandResults.push(...vac.commandResults);
    if (!vac.ok && input.mailboxes.length > 0) hardFail = true;
    else if (vac.ok) didWork = true;
  }

  void input.suspended;

  if (hardFail) {
    return {
      ok: false,
      apply_status: 'partial',
      notes: [...notes, tl('notes.auto.n1220')],
      written,
      commandResults,
    };
  }
  if (!didWork) {
    return {
      ok: true,
      apply_status: 'written',
      notes: [...notes, tl('notes.auto.n1093')],
      written,
      commandResults,
    };
  }
  return {
    ok: true,
    apply_status: 'applied',
    notes: [...notes, tl('notes.auto.n1212')],
    written,
    commandResults,
  };
}
