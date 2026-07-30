/**
 * Intelligent software update & vulnerability advice (structured, pure logic).
 */

import type { RiskTier, UpdateAdvice, UpdateItemDto } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';

export interface PackageInventoryItem {
  packageName: string;
  currentVersion: string;
  candidateVersion?: string;
  changelogSnippet?: string;
  knownCves?: string[];
  hasSecurityFix?: boolean;
  hasBreakingChange?: boolean;
}

/**
 * Derive structured update advice from inventory + advisory signals.
 * Policy:
 * - high/critical risk always requires human approval
 * - low-risk security patches (no HIGH/CRITICAL CVE, no breaking) may auto-update
 * - routine medium updates require approval
 */
export function adviseUpdate(item: PackageInventoryItem): UpdateItemDto {
  if (!item.packageName || !item.currentVersion) {
    throw new YskError(ErrorCodes.VALIDATION, '請提供套件名稱與目前版本', {
      httpStatus: 400,
    });
  }
  const candidate = item.candidateVersion ?? item.currentVersion;
  const same = candidate === item.currentVersion;
  const cves = item.knownCves ?? [];

  let advice: UpdateAdvice = 'skip';
  let risk: RiskTier = 'low';
  let requiresApproval = false;
  let summary = same
    ? '已裝版本 = apt Candidate，無可用升級'
    : '有可用升級';

  if (!same) {
    const hasCritical = cves.some((c) => /CRITICAL/i.test(c));
    const hasHigh = cves.some((c) => /HIGH/i.test(c));

    if (hasCritical) {
      advice = 'urgent';
      risk = 'critical';
      requiresApproval = true;
      summary = `可升級 ${item.currentVersion} → ${candidate}（CRITICAL CVE，需確認）`;
    } else if (hasHigh) {
      advice = 'update';
      risk = 'high';
      requiresApproval = true;
      summary = `可升級 ${item.currentVersion} → ${candidate}（HIGH CVE，需確認）`;
    } else if (item.hasBreakingChange) {
      advice = 'watch';
      risk = 'high';
      requiresApproval = true;
      summary = `可升級 ${item.currentVersion} → ${candidate}（可能不相容，需確認）`;
    } else if (item.hasSecurityFix) {
      advice = 'update';
      risk = 'low';
      requiresApproval = false;
      summary = `可升級 ${item.currentVersion} → ${candidate}（安全修補）`;
    } else {
      advice = 'update';
      risk = 'medium';
      requiresApproval = true;
      summary = `可升級 ${item.currentVersion} → ${candidate}（apt Candidate）`;
    }
  } else if (cves.length > 0) {
    summary = `無可用升級，但 OSV 標註已裝版有 ${cves.length} 項漏洞信號`;
    risk = cves.some((c) => /CRITICAL|HIGH/i.test(c)) ? 'high' : 'medium';
    requiresApproval = true;
    advice = 'watch';
  }

  // Invariant: high and critical always require approval
  if (risk === 'high' || risk === 'critical') {
    requiresApproval = true;
  }

  return {
    packageName: item.packageName,
    currentVersion: item.currentVersion,
    candidateVersion: candidate,
    advice,
    risk,
    cves,
    requiresApproval,
    summary,
  };
}

/**
 * Build public advisory lookup query descriptors (NVD / GHSA style).
 */
export function buildAdvisoryQueries(
  packageName: string,
  version: string,
): Array<{ source: string; query: string }> {
  if (!packageName) {
    throw new YskError(ErrorCodes.VALIDATION, '請提供套件名稱', { httpStatus: 400 });
  }
  return [
    { source: 'nvd', query: `cpe:2.3:a:*:${packageName}:${version}:*:*:*:*:*:*:*` },
    { source: 'github-advisory', query: packageName },
    { source: 'ubuntu-security', query: packageName },
  ];
}

export interface UpdateExecutionPlan {
  mode: 'auto' | 'approval';
  commands: string[];
  rollbackCommands: string[];
  audit: Record<string, string>;
}

/**
 * Plan package update execution with rollback hints.
 */
export function planUpdateExecution(item: UpdateItemDto): UpdateExecutionPlan {
  const mode = item.requiresApproval ? 'approval' : 'auto';
  return {
    mode,
    commands: [
      `apt-get install -y --only-upgrade ${item.packageName}=${item.candidateVersion} || npm update -g ${item.packageName}@${item.candidateVersion}`,
    ],
    rollbackCommands: [
      `apt-get install -y --allow-downgrades ${item.packageName}=${item.currentVersion} || npm install -g ${item.packageName}@${item.currentVersion}`,
    ],
    audit: {
      package: item.packageName,
      from: item.currentVersion,
      to: item.candidateVersion,
      advice: item.advice,
      risk: item.risk,
    },
  };
}
