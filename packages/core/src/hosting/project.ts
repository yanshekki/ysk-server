/**
 * Project / Site isolation model — independent Linux user/group per project.
 *
 * Contract:
 * - homeDir = /home/ysk-server-{projectId}
 * - linuxUser derived from projectId (≤32 chars), not display name
 * - One user ↔ one project; names immutable after create
 */

import type { ProjectDto } from 'ysk-server-shared';
import { ErrorCodes, YskError, tl} from 'ysk-server-shared';

/** Canonical home directory prefix (trailing path is full project UUID). */
export const PROJECT_HOME_PREFIX = '/home/ysk-server-';

/** Linux username prefix (short; total user ≤ 32). */
export const LINUX_USER_PREFIX = 'ysks_';

/**
 * Canonical project home: /home/ysk-server-{projectId}
 */
export function projectHomeDir(projectId: string): string {
  const id = projectId.trim();
  if (!id || id.includes('/') || id.includes('..')) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0683'), {
      httpStatus: 400 });
  }
  return `${PROJECT_HOME_PREFIX}${id}`;
}

/**
 * Safe Linux username from project id (stable, unique, ≤32).
 * Uses first 12 hex chars of UUID → `ysks_{12hex}` (16 chars).
 */
export function deriveLinuxUserFromProjectId(projectId: string): string {
  const hex = projectId
    .toLowerCase()
    .replace(/-/g, '')
    .replace(/[^a-f0-9]/g, '');
  if (hex.length < 8) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0684'), {
      httpStatus: 400 });
  }
  const base = hex.slice(0, 12);
  const name = `${LINUX_USER_PREFIX}${base}`;
  if (name.length > 32) {
    return name.slice(0, 32);
  }
  return name;
}

/**
 * @deprecated Prefer deriveLinuxUserFromProjectId — name-based users collide.
 * Kept for legacy project rows and tests that still reference slug users.
 */
export function deriveLinuxUser(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  if (!slug) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0689'), {
      httpStatus: 400 });
  }
  return `ysk_${slug}`;
}

/**
 * True if path is the canonical /home/ysk-server-{projectId}.
 */
export function isCanonicalProjectHome(homeDir: string, projectId: string): boolean {
  return homeDir === projectHomeDir(projectId);
}

/**
 * Allow delete/chown only for:
 * - /home/ysk-server-{uuid}
 * - control-plane degraded shadow …/homes/ysk-server-{id}
 * - legacy …/projects/{linuxUser}
 */
export function isSafeProjectHomePath(
  homeDir: string,
  opts: { projectId: string; dataDir?: string; linuxUser?: string },
): boolean {
  const home = homeDir.replace(/\/+$/, '');
  if (home === projectHomeDir(opts.projectId)) return true;
  // UUID-ish project id in path
  if (home === `${PROJECT_HOME_PREFIX}${opts.projectId}`) return true;
  if (opts.dataDir) {
    const shadow = joinPosix(opts.dataDir, 'homes', `ysk-server-${opts.projectId}`);
    if (home === shadow.replace(/\/+$/, '')) return true;
    if (opts.linuxUser) {
      const legacy = joinPosix(opts.dataDir, 'projects', opts.linuxUser);
      if (home === legacy.replace(/\/+$/, '')) return true;
    }
  }
  // Absolute /home/ysk-server-* only (reject /home/other)
  if (home.startsWith(PROJECT_HOME_PREFIX) && !home.slice(PROJECT_HOME_PREFIX.length).includes('/')) {
    return home === projectHomeDir(opts.projectId);
  }
  return false;
}

function joinPosix(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter(Boolean)
    .join('/');
}

/**
 * Build project isolation plan (pure — does not call useradd).
 */
export function planProjectIsolation(input: {
  id: string;
  name: string;
  domain?: string;
  runtime: ProjectDto['runtime'];
  runtimeVersion?: string;
  env?: 'staging' | 'production';
}): {
  project: ProjectDto;
  commands: string[];
  notes: string[];
} {
  if (!input.name?.trim()) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.needProjectName'), { httpStatus: 400 });
  }
  if (!input.id?.trim()) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0682'), { httpStatus: 400 });
  }
  const linuxUser = deriveLinuxUserFromProjectId(input.id);
  const linuxGroup = linuxUser;
  const homeDir = projectHomeDir(input.id);
  const project: ProjectDto = {
    id: input.id,
    name: input.name.trim(),
    domain: input.domain,
    linuxUser,
    linuxGroup,
    homeDir,
    runtime: input.runtime,
    runtimeVersion: input.runtimeVersion,
    env: input.env ?? 'production' };
  const commands = [
    `groupadd --system ${linuxGroup} 2>/dev/null || true`,
    `id ${linuxUser} >/dev/null 2>&1 || useradd --system --gid ${linuxGroup} --home-dir ${homeDir} --create-home --shell /usr/sbin/nologin ${linuxUser}`,
    `mkdir -p ${homeDir}/app ${homeDir}/logs ${homeDir}/tmp`,
    `chown -R ${linuxUser}:${linuxGroup} ${homeDir}`,
    `chmod 750 ${homeDir}`,
    // ysk-web: allow www-data to read static trees (see project-web-group.ts)
    `groupadd --system ysk-web 2>/dev/null || true`,
    `id www-data >/dev/null 2>&1 && usermod -aG ysk-web www-data 2>/dev/null || true`,
    `usermod -aG ysk-web ${linuxUser} 2>/dev/null || true`,
    `chgrp -R ysk-web ${homeDir} 2>/dev/null || true`,
    `chmod -R g+rX ${homeDir}/app ${homeDir}/app/public ${homeDir}/public 2>/dev/null || true`,
  ];
  return {
    project,
    commands,
    notes: [
      tl('notes.auto.n1043'),
      `home：${homeDir}`,
      `user：${linuxUser}`,
      tl('notes.auto.n0474'),
      tl('notes.auto.n1546'),
    ] };
}
