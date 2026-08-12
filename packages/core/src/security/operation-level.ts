/**
 * Map tool risk / allowlist entry to RBAC operation level.
 */

import type { OperationLevel, RiskTier } from '@yanshekki/shared';

/**
 * Convert a risk tier into the minimum RBAC operation level required.
 */
export function riskToOperationLevel(risk: RiskTier): OperationLevel {
  switch (risk) {
    case 'low':
      return 'read';
    case 'medium':
      return 'write-low';
    case 'high':
      return 'write-high';
    case 'critical':
      return 'destructive';
    default:
      return 'privilege';
  }
}

/**
 * For write-ish tools that are low risk (e.g. future), still elevate past pure read
 * when the tool name indicates mutation.
 */
export function toolImpliedLevel(tool: string, risk: RiskTier): OperationLevel {
  const fromRisk = riskToOperationLevel(risk);
  if (tool.startsWith('fs.read') || tool.startsWith('fs.list') || tool.startsWith('sys.') || tool.startsWith('process.list') || tool.includes('.status')) {
    return 'read';
  }
  if (tool.startsWith('fs.write') || tool.startsWith('service.restart') || tool.startsWith('pkg.')) {
    // at least write-low / write-high depending on risk
    return fromRisk === 'read' ? 'write-low' : fromRisk;
  }
  if (tool.includes('delete') || tool.includes('remove') || tool.includes('flush')) {
    return fromRisk === 'read' || fromRisk === 'write-low' ? 'destructive' : fromRisk;
  }
  return fromRisk;
}
