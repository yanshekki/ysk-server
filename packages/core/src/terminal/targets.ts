/**
 * List interactive shell targets for the web terminal.
 */

import { existsSync } from 'node:fs';
import type { HostExecutor } from '../host/executor.js';

export type TerminalTargetDto =
  | {
      kind: 'root';
      id: 'root';
      label: string;
      linuxUser: 'root';
      available: boolean;
      notes: string[];
    }
  | {
      kind: 'project';
      id: string;
      label: string;
      projectId: string;
      projectName: string;
      linuxUser: string;
      homeDir: string;
      available: boolean;
      notes: string[];
    };

export async function listTerminalTargets(input: {
  host: HostExecutor;
  projects: Array<{
    id: string;
    name: string;
    linuxUser: string;
    homeDir: string;
    osProvisioned?: boolean;
  }>;
}): Promise<{
  executeEnabled: boolean;
  isRoot: boolean;
  canOpen: boolean;
  items: TerminalTargetDto[];
  notes: string[];
}> {
  const executeEnabled = input.host.executeEnabled();
  const isRoot = input.host.isRoot();
  const canOpen = executeEnabled && isRoot;
  const notes: string[] = [];
  if (!executeEnabled) notes.push('YSK_EXECUTE required');
  if (!isRoot) notes.push('control plane must run as root for user shells');

  const items: TerminalTargetDto[] = [];

  items.push({
    kind: 'root',
    id: 'root',
    label: 'root',
    linuxUser: 'root',
    available: canOpen,
    notes: canOpen ? [] : [...notes],
  });

  for (const p of input.projects) {
    const user = String(p.linuxUser || '').trim();
    const home = String(p.homeDir || '').trim();
    const pNotes: string[] = [];
    if (!canOpen) pNotes.push(...notes);
    if (!user) pNotes.push('missing linuxUser');
    if (!p.osProvisioned) pNotes.push('OS user not provisioned');
    if (home && !existsSync(home)) pNotes.push('home dir missing');

    // Soft availability: canOpen + user name present; provisioned preferred
    const available = canOpen && Boolean(user) && Boolean(p.osProvisioned);

    items.push({
      kind: 'project',
      id: `project:${p.id}`,
      label: `${p.name} (${user || '—'})`,
      projectId: p.id,
      projectName: p.name,
      linuxUser: user || '—',
      homeDir: home || '',
      available,
      notes: pNotes,
    });
  }

  return { executeEnabled, isRoot, canOpen, items, notes };
}
