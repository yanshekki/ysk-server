/**
 * Kernel Sandbox policy planner — pure orchestration (no real nsenter/seccomp apply here).
 */

import { ErrorCodes, YskError, tl} from '@ysk/shared';

export interface SandboxPolicy {
  /** Linux user the process should run as */
  runAsUser?: string;
  /** Allowed filesystem roots */
  allowedPaths: string[];
  /** Network allowed? */
  network: boolean;
  /** Max CPU percent hint */
  cpuPercent?: number;
  /** Max memory MB */
  memoryMb?: number;
  /** Seccomp profile name */
  seccompProfile: 'default' | 'strict' | 'unconfined';
}

export interface SandboxPlan {
  policy: SandboxPolicy;
  /** Concrete commands that would be used on a real host (not executed here) */
  commands: string[];
  notes: string[];
}

const DEFAULT_POLICY: SandboxPolicy = {
  allowedPaths: ['/tmp', '/var/lib/ysk-server'],
  network: false,
  cpuPercent: 50,
  memoryMb: 512,
  seccompProfile: 'default',
};

/**
 * Build a sandbox execution plan for a constrained command.
 */
export function planSandbox(
  command: string[],
  overrides: Partial<SandboxPolicy> = {},
): SandboxPlan {
  if (!command.length) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1051'), {
      httpStatus: 400,
    });
  }
  const policy: SandboxPolicy = { ...DEFAULT_POLICY, ...overrides };
  if (policy.seccompProfile === 'unconfined' && !policy.runAsUser) {
    throw new YskError(
      ErrorCodes.SANDBOX_VIOLATION,
      tl('notes.auto.n1592'),
      { httpStatus: 400 },
    );
  }
  const commands: string[] = [];
  if (policy.runAsUser) {
    commands.push(`runuser -u ${policy.runAsUser} -- ${command.join(' ')}`);
  } else {
    commands.push(command.join(' '));
  }
  const notes = [
    `network=${policy.network}`,
    `seccomp=${policy.seccompProfile}`,
    `paths=${policy.allowedPaths.join(',')}`,
  ];
  if (policy.memoryMb) notes.push(`memoryMb=${policy.memoryMb}`);
  if (policy.cpuPercent) notes.push(`cpuPercent=${policy.cpuPercent}`);
  return { policy, commands, notes };
}

/**
 * Validate that a path is within allowed roots.
 * Empty / whitespace roots are ignored (never treat as filesystem root).
 * Uses boundary-safe prefix (`root + '/'`) so `/var` does not match `/var-evil`.
 */
export function pathAllowed(path: string, allowedPaths: string[]): boolean {
  if (!path || typeof path !== 'string' || path.includes('\0')) return false;
  const normalized = path.replace(/\/+$/, '') || '/';
  return allowedPaths.some((root) => {
    if (!root || typeof root !== 'string' || !root.trim()) return false;
    const r = root.replace(/\/+$/, '') || '/';
    // Bare `/` would allow everything — require explicit single-root policy
    if (r === '/') return normalized === '/';
    return normalized === r || normalized.startsWith(r + '/');
  });
}
