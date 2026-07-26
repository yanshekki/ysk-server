import type { ProjectDto } from '@ysk/shared';

export type ProjectRuntime = ProjectDto['runtime'];

export interface ProjectUiProfile {
  runtime: ProjectRuntime;
  /** Header primary deploy */
  showDeploy: boolean;
  deployIsPhp: boolean;
  showStop: boolean;
  showProcessPort: boolean;
  showPid: boolean;
  /** Tabs */
  showDeployTab: boolean;
  showGit: boolean;
  showEnv: boolean;
  showResourcesTab: boolean;
  showWordpress: boolean;
  showLogsTab: boolean;
  /** Labels */
  processLabelKey: string;
  processLabelFallback: string;
}

function processProfile(
  runtime: ProjectRuntime,
  labelFallback: string,
): ProjectUiProfile {
  return {
    runtime,
    showDeploy: true,
    deployIsPhp: false,
    showStop: true,
    showProcessPort: true,
    showPid: true,
    showDeployTab: true,
    showGit: true,
    showEnv: true,
    showResourcesTab: true,
    showWordpress: false,
    showLogsTab: true,
    processLabelKey: 'projects.railProcess',
    processLabelFallback: labelFallback,
  };
}

export function getProjectUiProfile(runtime: ProjectRuntime): ProjectUiProfile {
  if (runtime === 'php') {
    return {
      runtime,
      showDeploy: true,
      deployIsPhp: true,
      showStop: true,
      showProcessPort: false,
      showPid: false,
      showDeployTab: true,
      showGit: true,
      showEnv: true,
      showResourcesTab: true,
      showWordpress: true,
      showLogsTab: true,
      processLabelKey: 'projects.railPhp',
      processLabelFallback: 'PHP / 站點',
    };
  }
  if (runtime === 'static') {
    return {
      runtime,
      showDeploy: false,
      deployIsPhp: false,
      showStop: false,
      showProcessPort: false,
      showPid: false,
      showDeployTab: true,
      showGit: true,
      showEnv: false,
      showResourcesTab: false,
      showWordpress: false,
      showLogsTab: true,
      processLabelKey: 'projects.railStatic',
      processLabelFallback: '靜態站點',
    };
  }
  if (runtime === 'python') return processProfile('python', 'Python 行程');
  if (runtime === 'go') return processProfile('go', 'Go 行程');
  if (runtime === 'rust') return processProfile('rust', 'Rust 行程');
  // node (default)
  return processProfile('node', 'Node 行程');
}

export function formatRuntimeName(runtime?: string): string {
  if (runtime === 'php') return 'PHP';
  if (runtime === 'node') return 'Node.js';
  if (runtime === 'static') return '靜態';
  if (runtime === 'python') return 'Python';
  if (runtime === 'go') return 'Go';
  if (runtime === 'rust') return 'Rust';
  return runtime ?? '—';
}
