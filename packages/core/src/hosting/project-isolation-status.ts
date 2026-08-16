import { getLocale, tl } from 'ysk-server-shared';
/**
 * Pure helpers: detect legacy isolation layout & build readiness items.
 */

import { existsSync } from 'node:fs';
import {
  deriveLinuxUserFromProjectId,
  isCanonicalProjectHome,
  projectHomeDir } from './project.js';
import type { ReadinessItem } from './production-readiness.js';

export interface ProjectIsolationSnapshot {
  id: string;
  name: string;
  linuxUser: string;
  homeDir: string;
  osProvisioned: boolean;
  /** Panel owner for package quota (optional) */
  ownerUserId?: string;
}

export type IsolationReportRow = IsolationMigrationPlan & {
  name: string;
  osProvisioned: boolean;
  ownerUserId?: string;
  missingOwner: boolean;
  /** Ready for production isolation (canonical home + provisioned + home exists) */
  productionReady: boolean;
};

/** List separator under request locale (avoid hard-coded CJK顿号 in EN UI). */
function listSep(): string {
  return getLocale() === 'en' ? ', ' : '、';
}

function clauseSep(): string {
  return getLocale() === 'en' ? '; ' : '；';
}

export interface IsolationMigrationPlan {
  projectId: string;
  needsMigration: boolean;
  reasons: string[];
  currentHome: string;
  targetHome: string;
  currentLinuxUser: string;
  preferredLinuxUser: string;
  /** true if linux user string differs from id-derived name (legacy name-slug) */
  legacyUserName: boolean;
  homeIsCanonical: boolean;
}

export function planIsolationMigration(p: ProjectIsolationSnapshot): IsolationMigrationPlan {
  const targetHome = projectHomeDir(p.id);
  const preferredLinuxUser = deriveLinuxUserFromProjectId(p.id);
  const homeIsCanonical = isCanonicalProjectHome(p.homeDir, p.id);
  const legacyUserName = p.linuxUser !== preferredLinuxUser;
  const reasons: string[] = [];
  if (!homeIsCanonical) {
    reasons.push(tl('notes.auto.t0369', { v0: (p.homeDir), v1: (targetHome) }));
  }
  if (!p.osProvisioned) {
    reasons.push(tl('notes.auto.n0701'));
  }
  if (legacyUserName) {
    reasons.push(
      tl('notes.auto.t0370', { v0: (p.linuxUser), v1: (preferredLinuxUser) }),
    );
  }
  if (p.osProvisioned && homeIsCanonical && !existsSync(p.homeDir)) {
    reasons.push(tl('notes.auto.n0092'));
  }
  if (!p.ownerUserId) {
    reasons.push('missing panel owner_user_id (package quota attribution)');
  }
  const homeExists = homeIsCanonical && existsSync(p.homeDir);
  return {
    projectId: p.id,
    needsMigration:
      reasons.length > 0 &&
      (!homeIsCanonical || !p.osProvisioned || !homeExists || !p.ownerUserId),
    reasons,
    currentHome: p.homeDir,
    targetHome,
    currentLinuxUser: p.linuxUser,
    preferredLinuxUser,
    legacyUserName,
    homeIsCanonical };
}

/** Build per-project isolation report for CLI / API bulk view. */
export function listIsolationReport(
  projects: ProjectIsolationSnapshot[],
): {
  items: IsolationReportRow[];
  summary: {
    total: number;
    productionReady: number;
    needsMigration: number;
    missingOwner: number;
    unprovisioned: number;
  };
} {
  const items: IsolationReportRow[] = projects.map((p) => {
    const plan = planIsolationMigration(p);
    const homeExists = plan.homeIsCanonical && existsSync(p.homeDir);
    const productionReady = Boolean(p.osProvisioned && homeExists && p.ownerUserId);
    return {
      ...plan,
      name: p.name,
      osProvisioned: p.osProvisioned,
      ownerUserId: p.ownerUserId,
      missingOwner: !p.ownerUserId,
      productionReady,
      // needsMigration already set; ensure production path ignores owner-only for OS migrate
      needsMigration:
        !homeExists || !p.osProvisioned || !plan.homeIsCanonical,
    };
  });
  return {
    items,
    summary: {
      total: items.length,
      productionReady: items.filter((i) => i.productionReady).length,
      needsMigration: items.filter((i) => i.needsMigration).length,
      missingOwner: items.filter((i) => i.missingOwner).length,
      unprovisioned: items.filter((i) => !i.osProvisioned).length,
    },
  };
}

/**
 * Aggregate readiness items for all projects' OS isolation.
 */
export function buildProjectIsolationReadinessItems(
  projects: ProjectIsolationSnapshot[],
): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  if (projects.length === 0) {
    items.push({
      id: 'projects-isolation-none',
      category: 'isolation',
      title: tl('notes.readiness.isolation'),
      level: 'ready',
      detail: tl('notes.auto.n0719'),
      spec: '§4.1' });
    return items;
  }

  let readyN = 0;
  let degradedN = 0;
  let missingN = 0;
  const problemNames: string[] = [];

  for (const p of projects) {
    const plan = planIsolationMigration(p);
    const homeOk = plan.homeIsCanonical && existsSync(p.homeDir);
    if (p.osProvisioned && homeOk) {
      readyN++;
    } else if (!p.osProvisioned) {
      missingN++;
      problemNames.push(p.name);
    } else {
      degradedN++;
      problemNames.push(p.name);
    }
  }

  const level =
    missingN > 0 ? 'missing' : degradedN > 0 ? 'degraded' : 'ready';
  items.push({
    id: 'projects-isolation-summary',
    category: 'isolation',
    title: tl('notes.auto.n0681'),
    level,
    detail: tl('notes.auto.t0371', { v0: (readyN), v1: (degradedN), v2: (missingN), v3: (projects.length) }) +
      (problemNames.length
        ? tl('notes.auto.t0372', {
            v0: problemNames.slice(0, 5).join(listSep()),
            v1: problemNames.length > 5 ? '…' : '',
          })
        : ''),
    spec: '§4.1',
    fixHint:
      tl('notes.auto.n0699'),
    fixHref: (() => {
      const first = projects.find((p) => {
        const plan = planIsolationMigration(p);
        return !p.osProvisioned || !plan.homeIsCanonical || !existsSync(p.homeDir);
      });
      return first ? `/projects/${encodeURIComponent(first.id)}?tab=isolation` : '/projects';
    })() });

  // Sample up to 8 non-ready projects as separate items for operators
  let listed = 0;
  for (const p of projects) {
    const plan = planIsolationMigration(p);
    if (!plan.needsMigration && p.osProvisioned && existsSync(p.homeDir)) continue;
    if (listed >= 8) break;
    listed++;
    const homeOk = plan.homeIsCanonical && existsSync(p.homeDir);
    items.push({
      id: `project-isolation-${p.id.slice(0, 8)}`,
      category: 'isolation',
      title: tl('notes.auto.t0373', { v0: (p.name) }),
      level: !p.osProvisioned ? 'missing' : homeOk ? 'ready' : 'degraded',
      detail: plan.reasons.join(clauseSep()) || `${p.linuxUser} @ ${p.homeDir}`,
      spec: '§4.1',
      fixHint: tl('notes.auto.n1455'),
      fixHref: `/projects/${encodeURIComponent(p.id)}?tab=isolation` });
  }

  return items;
}
