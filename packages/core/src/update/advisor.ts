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
    throw new YskError(ErrorCodes.VALIDATION, 'packageName and currentVersion required', {
      httpStatus: 400,
    });
  }
  const candidate = item.candidateVersion ?? item.currentVersion;
  const same = candidate === item.currentVersion;
  const cves = item.knownCves ?? [];

  let advice: UpdateAdvice = 'skip';
  let risk: RiskTier = 'low';
  let requiresApproval = false;
  let summary = 'No update available';

  if (!same) {
    const hasCritical = cves.some((c) => /CRITICAL/i.test(c));
    const hasHigh = cves.some((c) => /HIGH/i.test(c));

    if (hasCritical) {
      advice = 'urgent';
      risk = 'critical';
      requiresApproval = true;
      summary = 'Critical CVE-linked update; human approval required';
    } else if (hasHigh) {
      advice = 'update';
      risk = 'high';
      requiresApproval = true;
      summary = 'High-severity CVE update; human approval required';
    } else if (item.hasBreakingChange) {
      advice = 'watch';
      risk = 'high';
      requiresApproval = true;
      summary = 'Update available but may include breaking changes';
    } else if (item.hasSecurityFix) {
      // Security fix without HIGH/CRITICAL CVE tags and without breaking changes → auto-eligible
      advice = 'update';
      risk = 'low';
      requiresApproval = false;
      summary = 'Low-risk security update; eligible for auto-update';
    } else {
      // Routine upgrade
      advice = 'update';
      risk = 'medium';
      requiresApproval = true;
      summary = 'Routine update available; approval required';
    }
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
    throw new YskError(ErrorCodes.VALIDATION, 'packageName required', { httpStatus: 400 });
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
