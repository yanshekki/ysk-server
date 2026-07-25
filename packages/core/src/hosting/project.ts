/**
 * Project / Site isolation model — independent Linux user/group per project.
 */

import type { ProjectDto } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';

const USER_PREFIX = 'ysk_';
const HOME_ROOT = '/var/lib/ysk-server/projects';

/**
 * Derive a safe Linux username from project name.
 */
export function deriveLinuxUser(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  if (!slug) {
    throw new YskError(ErrorCodes.VALIDATION, 'Project name yields empty linux user', {
      httpStatus: 400,
    });
  }
  return `${USER_PREFIX}${slug}`;
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
    throw new YskError(ErrorCodes.VALIDATION, 'Project name is required', { httpStatus: 400 });
  }
  const linuxUser = deriveLinuxUser(input.name);
  const linuxGroup = linuxUser;
  const homeDir = `${HOME_ROOT}/${linuxUser}`;
  const project: ProjectDto = {
    id: input.id,
    name: input.name.trim(),
    domain: input.domain,
    linuxUser,
    linuxGroup,
    homeDir,
    runtime: input.runtime,
    runtimeVersion: input.runtimeVersion,
    env: input.env ?? 'production',
  };
  const commands = [
    `groupadd --system ${linuxGroup}`,
    `useradd --system --gid ${linuxGroup} --home-dir ${homeDir} --create-home --shell /usr/sbin/nologin ${linuxUser}`,
    `mkdir -p ${homeDir}/{app,logs,tmp}`,
    `chown -R ${linuxUser}:${linuxGroup} ${homeDir}`,
    `chmod 750 ${homeDir}`,
  ];
  return {
    project,
    commands,
    notes: [
      'Each project runs as an independent Linux user/group',
      'Commands require root on target host; not executed by control plane unit tests',
    ],
  };
}
