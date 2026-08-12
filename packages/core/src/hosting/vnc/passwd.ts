/**
 * Write TigerVNC ~/.vnc/passwd via vncpasswd -f when available.
 */

import type { HostExecutor } from '../../host/executor.js';
import { shellQuote } from '../project-user-run.js';
import { tl } from '@yanshekki/shared';

export async function writeVncPassword(input: {
  host: HostExecutor;
  linuxUser: string;
  home: string;
  password: string;
}): Promise<{
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
}> {
  const notes: string[] = [];
  const { host, linuxUser, home, password } = input;
  if (!password || password.length < 6) {
    notes.push(tl('notes.vnc.passwordTooShort'));
    return { ok: false, notes };
  }
  if (!host.executeEnabled() || !host.isRoot()) {
    notes.push(tl('notes.vnc.passwordWrittenOnly'));
    return {
      ok: true,
      notes,
      blocked: true,
      requiresExecute: !host.executeEnabled(),
    };
  }

  const vncDir = `${home.replace(/\/$/, '')}/.vnc`;
  const script = [
    `mkdir -p ${shellQuote(vncDir)}`,
    `chown ${shellQuote(linuxUser)}:${shellQuote(linuxUser)} ${shellQuote(vncDir)}`,
    // vncpasswd -f reads password from stdin (first line); some builds need twice
    `printf '%s\\n' ${shellQuote(password)} | vncpasswd -f > ${shellQuote(vncDir + '/passwd')} 2>/dev/null || printf '%s\\n%s\\n' ${shellQuote(password)} ${shellQuote(password)} | vncpasswd -f > ${shellQuote(vncDir + '/passwd')}`,
    `chmod 600 ${shellQuote(vncDir + '/passwd')}`,
    `chown ${shellQuote(linuxUser)}:${shellQuote(linuxUser)} ${shellQuote(vncDir + '/passwd')}`,
  ].join(' && ');

  const r = await host.runCommand(['bash', '-c', script], { timeoutMs: 15_000 });
  if (r.exitCode !== 0) {
    notes.push(
      tl('notes.vnc.passwordFailed', {
        detail: (r.stderr || r.stdout || '').slice(0, 200),
      }),
    );
    return { ok: false, notes };
  }
  notes.push(tl('notes.vnc.passwordSet', { user: linuxUser }));
  return { ok: true, notes };
}
