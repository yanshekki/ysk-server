/**
 * Pure helpers: detect legacy isolation layout & build readiness items.
 */

import { existsSync } from 'node:fs';
import {
  deriveLinuxUserFromProjectId,
  isCanonicalProjectHome,
  projectHomeDir,
} from './project.js';
import type { ReadinessItem } from './production-readiness.js';

export interface ProjectIsolationSnapshot {
  id: string;
  name: string;
  linuxUser: string;
  homeDir: string;
  osProvisioned: boolean;
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
    reasons.push(`home 非意圖路徑（目前 ${p.homeDir} → 應為 ${targetHome}）`);
  }
  if (!p.osProvisioned) {
    reasons.push('尚未 os_provisioned');
  }
  if (legacyUserName) {
    reasons.push(
      `Linux 用戶名為舊式「${p.linuxUser}」（新建會用 ${preferredLinuxUser}）；遷移會保留現有用戶名並改 home`,
    );
  }
  if (p.osProvisioned && homeIsCanonical && !existsSync(p.homeDir)) {
    reasons.push('DB 標記已隔離但 home 目錄不存在');
  }
  return {
    projectId: p.id,
    needsMigration: reasons.length > 0 && (!homeIsCanonical || !p.osProvisioned || !existsSync(p.homeDir)),
    reasons,
    currentHome: p.homeDir,
    targetHome,
    currentLinuxUser: p.linuxUser,
    preferredLinuxUser,
    legacyUserName,
    homeIsCanonical,
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
      title: '專案隔離',
      level: 'ready',
      detail: '尚無專案',
      spec: '§4.1',
    });
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
    title: '專案 Linux 用戶隔離',
    level,
    detail: `就緒 ${readyN} / 降級 ${degradedN} / 未隔離 ${missingN}（共 ${projects.length}）` +
      (problemNames.length
        ? `；待處理：${problemNames.slice(0, 5).join('、')}${problemNames.length > 5 ? '…' : ''}`
        : ''),
    spec: '§4.1',
    fixHint:
      '專案詳情 → 資源 → 建立系統用戶／遷移到 /home/ysk-server-{id}（需 YSK_EXECUTE + root）',
  });

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
      title: `專案「${p.name}」隔離`,
      level: !p.osProvisioned ? 'missing' : homeOk ? 'ready' : 'degraded',
      detail: plan.reasons.join('；') || `${p.linuxUser} @ ${p.homeDir}`,
      spec: '§4.1',
      fixHint: '資源分頁：建立／遷移系統用戶',
    });
  }

  return items;
}
