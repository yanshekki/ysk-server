/**
 * Pure spawn plan for interactive login shells (web terminal).
 * Actual PTY is opened by the server (node-pty).
 */

export type TerminalTargetKind = 'root' | 'project';

export type TerminalSpawnPlan = {
  kind: TerminalTargetKind;
  /** OS username for the shell */
  linuxUser: string;
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  projectId?: string;
  projectName?: string;
};

export function buildRootSpawnPlan(opts?: {
  cols?: number;
  rows?: number;
  home?: string;
}): TerminalSpawnPlan {
  const home = opts?.home || process.env.HOME || '/root';
  return {
    kind: 'root',
    linuxUser: 'root',
    file: 'bash',
    args: ['-l'],
    cwd: home,
    env: baseEnv({
      USER: 'root',
      HOME: home,
      LOGNAME: 'root',
      cols: opts?.cols,
      rows: opts?.rows,
    }),
  };
}

export function buildProjectSpawnPlan(input: {
  linuxUser: string;
  homeDir: string;
  projectId: string;
  projectName: string;
  cols?: number;
  rows?: number;
}): TerminalSpawnPlan {
  const user = String(input.linuxUser || '').trim();
  const home = String(input.homeDir || '').trim() || `/home/${user}`;
  if (!user || user === 'root') {
    throw new Error('invalid project linux user');
  }
  // Isolated login shell as project user (same isolation model as project-user-run)
  return {
    kind: 'project',
    linuxUser: user,
    file: 'runuser',
    args: ['-u', user, '--', 'bash', '-l'],
    cwd: home,
    env: baseEnv({
      USER: user,
      HOME: home,
      LOGNAME: user,
      cols: input.cols,
      rows: input.rows,
    }),
    projectId: input.projectId,
    projectName: input.projectName,
  };
}

function baseEnv(input: {
  USER: string;
  HOME: string;
  LOGNAME: string;
  cols?: number;
  rows?: number;
}): Record<string, string> {
  const cols = Math.max(20, Math.min(500, input.cols ?? 120));
  const rows = Math.max(5, Math.min(200, input.rows ?? 32));
  return {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: process.env.LANG || 'C.UTF-8',
    USER: input.USER,
    HOME: input.HOME,
    LOGNAME: input.LOGNAME,
    SHELL: '/bin/bash',
    // Hint for shell prompt tools
    YSK_TERMINAL: '1',
    COLUMNS: String(cols),
    LINES: String(rows),
  };
}
