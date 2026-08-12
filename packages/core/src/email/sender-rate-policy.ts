import { tl } from 'ysk-server-shared';
/**
 * Per-sender (envelope from domain) rate policy via Postfix check_policy_service.
 * Generates a small Python3 policy daemon + master.cf / main.cf hooks.
 */

import { mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';

/** Build domain → msgs/hour map from policy rate.cf files */
export function loadDomainRateMap(dataDir: string): Record<string, number> {
  const root = join(dataDir, 'email', 'policy');
  const out: Record<string, number> = {};
  if (!existsSync(root)) return out;
  try {
    for (const name of readdirSync(root)) {
      const f = join(root, name, 'rate.cf');
      if (!existsSync(f)) continue;
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const [dom, n] = t.split(/\s+/);
        const rate = Number(n);
        if (dom && Number.isFinite(rate) && rate > 0) out[dom.toLowerCase()] = Math.floor(rate);
      }
    }
  } catch {
    /* empty */
  }
  return out;
}

export function writeSenderRatePolicyDaemon(dataDir: string): {
  written: string[];
  notes: string[];
  scriptPath: string;
  ratesPath: string;
} {
  const dir = join(dataDir, 'email', 'policy');
  mkdirSync(dir, { recursive: true });
  const rates = loadDomainRateMap(dataDir);
  const ratesPath = join(dir, 'sender-rates.json');
  writeFileSync(ratesPath, JSON.stringify(rates, null, 2), 'utf8');

  const scriptPath = join(dir, 'ysk-sender-rate-policy.py');
  // Minimal Postfix policy protocol server (reads one request, answers action=)
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env python3
"""YSK per-sender domain rate policy for Postfix check_policy_service.
Reads sender-rates.json (domain -> msgs/hour). State in state.json under same dir.
"""
import json, os, sys, time
from pathlib import Path

DIR = Path(__file__).resolve().parent
RATES = DIR / "sender-rates.json"
STATE = Path(os.environ.get("YSK_RATE_STATE", "/var/lib/ysk-server/sender-rate-state.json"))
DEFAULT = int(os.environ.get("YSK_RATE_DEFAULT", "500"))

def load_rates():
    try:
        return json.loads(RATES.read_text())
    except Exception:
        return {}

def load_state():
    try:
        return json.loads(STATE.read_text())
    except Exception:
        return {}

def save_state(st):
    try:
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps(st))
    except Exception:
        pass

def domain_of(addr: str) -> str:
    addr = (addr or "").strip().lower()
    if "@" in addr:
        return addr.split("@", 1)[1]
    return addr

def decide(attrs: dict) -> str:
    # Only enforce on end-of-data / mail path with sasl or sender
    sender = attrs.get("sender") or attrs.get("sasl_username") or ""
    dom = domain_of(sender)
    if not dom:
        return "DUNNO"
    rates = load_rates()
    limit = int(rates.get(dom, DEFAULT))
    if limit <= 0:
        return "DUNNO"
    now = int(time.time())
    hour = now // 3600
    st = load_state()
    key = f"{dom}:{hour}"
    # prune old keys
    st = {k: v for k, v in st.items() if k.endswith(f":{hour}") or k.endswith(f":{hour-1}")}
    count = int(st.get(key, 0)) + 1
    st[key] = count
    save_state(st)
    if count > limit:
        return f"DEFER_IF_PERMIT YSK rate limit {limit}/h for {dom} (#{count})"
    return "DUNNO"

def main():
    attrs = {}
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.rstrip("\\r\\n")
        if line == "":
            action = decide(attrs)
            sys.stdout.write(f"action={action}\\n\\n")
            sys.stdout.flush()
            attrs = {}
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            attrs[k.strip()] = v.strip()

if __name__ == "__main__":
    main()
`,
    'utf8',
  );

  const masterSnippet = join(dir, 'master.cf.ysk-rate.snippet');
  writeFileSync(
    masterSnippet,
    `# YSK — append to master.cf (applySystem installs)
ysk_rate  unix  -       n       n       -       0       spawn
  user=nobody argv=/usr/bin/python3 ${scriptPath}
`,
    'utf8',
  );

  return {
    written: [ratesPath, scriptPath, masterSnippet],
    notes: [
      tl('notes.auto.t0069', { v0: (Object.keys(rates).length) }),
      scriptPath,
    ],
    scriptPath,
    ratesPath };
}

/**
 * Install policy service into Postfix (EXECUTE+root).
 */
export async function applySenderRatePolicyService(input: {
  dataDir: string;
  host: HostExecutor;
}): Promise<{
  ok: boolean;
  notes: string[];
  written: string[];
  blocked?: boolean;
  blockMessage?: string;
  apply_status: 'written' | 'applied' | 'blocked';
}> {
  const gen = writeSenderRatePolicyDaemon(input.dataDir);
  const notes = [...gen.notes];
  const written = [...gen.written];

  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    notes.push(tl('notes.auto.n1216'));
    return {
      ok: false,
      notes,
      written,
      blocked: true,
      blockMessage: tl('notes.auto.n1586'),
      apply_status: 'blocked' };
  }

  const sysDir = '/etc/ysk-server/email/policy';
  const stateDir = '/var/lib/ysk-server';
  const scriptSys = `${sysDir}/ysk-sender-rate-policy.py`;
  const ratesSys = `${sysDir}/sender-rates.json`;

  // Stepwise — never mask postconf/reload with || true
  const steps: Array<{ name: string; argv: string[] }> = [
    {
      name: 'mkdir+copy',
      argv: [
        'bash',
        '-c',
        [
          `mkdir -p ${JSON.stringify(sysDir)} ${JSON.stringify(stateDir)}`,
          `cp -f ${JSON.stringify(gen.scriptPath)} ${JSON.stringify(scriptSys)}`,
          `cp -f ${JSON.stringify(gen.ratesPath)} ${JSON.stringify(ratesSys)}`,
          `chmod 755 ${JSON.stringify(scriptSys)}`,
        ].join(' && '),
      ] },
    {
      name: 'master.cf ysk_rate',
      argv: [
        'bash',
        '-c',
        `grep -q '^ysk_rate' /etc/postfix/master.cf 2>/dev/null || printf '\\n# YSK sender rate\\nysk_rate  unix  -       n       n       -       0       spawn\\n  user=nobody argv=/usr/bin/python3 %s\\n' ${JSON.stringify(scriptSys)} >> /etc/postfix/master.cf`,
      ] },
    {
      name: 'postconf end_of_data',
      argv: [
        'postconf',
        '-e',
        'smtpd_end_of_data_restrictions=check_policy_service unix:private/ysk_rate',
      ] },
    {
      name: 'postconf recipient (optional soft)',
      argv: [
        'bash',
        '-c',
        `grep -q 'private/ysk_rate' /etc/postfix/main.cf 2>/dev/null || postconf -e "smtpd_recipient_restrictions=\$smtpd_recipient_restrictions, check_policy_service unix:private/ysk_rate"`,
      ] },
    {
      name: 'postfix check',
      argv: ['bash', '-c', 'postfix check 2>&1 | tail -20; exit ${PIPESTATUS[0]:-0}'] },
    {
      name: 'reload postfix',
      argv: [
        'bash',
        '-c',
        'systemctl reload postfix 2>&1 || service postfix reload 2>&1',
      ] },
  ];

  let failed = 0;
  for (const step of steps) {
    const r = await input.host.runCommand(step.argv, { timeoutMs: 30_000 });
    if (r.exitCode !== 0) {
      failed += 1;
      notes.push(
        tl('notes.auto.t0070', { v0: (step.name), v1: (r.exitCode), v2: ((r.stderr || r.stdout).slice(0, 200)) }),
      );
      // Hard fail on copy / postconf end_of_data / reload
      if (
        step.name === 'mkdir+copy' ||
        step.name === 'postconf end_of_data' ||
        step.name === 'reload postfix'
      ) {
        notes.push(tl('notes.auto.n1224'));
        return {
          ok: false,
          notes,
          written: [...written, scriptSys, ratesSys],
          apply_status: 'written' };
      }
    } else {
      notes.push(`${step.name} ok`);
    }
  }

  notes.push(tl('notes.auto.n0155'));
  const ok = failed === 0;
  notes.push(ok ? tl('notes.auto.n0001') : tl('notes.tpl.statusWrittenPartial'));

  return {
    ok,
    notes,
    written: [...written, scriptSys, ratesSys],
    apply_status: ok ? 'applied' : 'written' };
}
