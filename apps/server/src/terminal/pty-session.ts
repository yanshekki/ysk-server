/**
 * Interactive PTY session backed by node-pty.
 */

import type { IPty } from 'node-pty';
import type { TerminalSpawnPlan } from '@ysk-server/core';

export type PtySession = {
  id: string;
  plan: TerminalSpawnPlan;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (info: { exitCode: number; signal?: number }) => void): void;
};

export async function openPtySession(
  plan: TerminalSpawnPlan,
  opts: { cols: number; rows: number; sessionId: string },
): Promise<PtySession> {
  let pty: typeof import('node-pty');
  try {
    pty = await import('node-pty');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`node-pty unavailable: ${msg}`);
  }

  const cols = Math.max(20, Math.min(500, opts.cols || 120));
  const rows = Math.max(5, Math.min(200, opts.rows || 32));

  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] != null),
    ),
    ...plan.env,
  };

  const proc: IPty = pty.spawn(plan.file, plan.args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: plan.cwd,
    env,
  });

  return {
    id: opts.sessionId,
    plan,
    write(data: string) {
      try {
        proc.write(data);
      } catch {
        /* closed */
      }
    },
    resize(c: number, r: number) {
      try {
        proc.resize(
          Math.max(20, Math.min(500, c || cols)),
          Math.max(5, Math.min(200, r || rows)),
        );
      } catch {
        /* closed */
      }
    },
    kill() {
      try {
        proc.kill();
      } catch {
        /* */
      }
    },
    onData(cb) {
      proc.onData(cb);
    },
    onExit(cb) {
      proc.onExit((ev) => {
        cb({ exitCode: ev.exitCode ?? 0, signal: ev.signal });
      });
    },
  };
}
