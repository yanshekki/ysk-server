import type { ProjectDto } from 'ysk-server-shared';
import type { TFunction } from 'i18next';

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
  /** Labels — use t(processLabelKey); processLabelFallback is English neutral */
  processLabelKey: string;
  processLabelFallback: string;
}

function processProfile(
  runtime: ProjectRuntime,
  labelKey: string,
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
    processLabelKey: labelKey,
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
      processLabelFallback: 'PHP / site',
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
      processLabelFallback: 'Static site',
    };
  }
  if (runtime === 'python') {
    return processProfile('python', 'projects.railPython', 'Python process');
  }
  if (runtime === 'go') {
    return processProfile('go', 'projects.railGo', 'Go process');
  }
  if (runtime === 'rust') {
    return processProfile('rust', 'projects.railRust', 'Rust process');
  }
  if (runtime === 'java') {
    return processProfile('java', 'projects.railJava', 'Java process');
  }
  if (runtime === 'kotlin') {
    return processProfile('kotlin', 'projects.railKotlin', 'Kotlin process');
  }
  if (runtime === 'bun') {
    return processProfile('bun', 'projects.railBun', 'Bun process');
  }
  // node (default)
  return processProfile('node', 'projects.railNode', 'Node process');
}

export function formatRuntimeName(runtime?: string, t?: TFunction): string {
  if (t) {
    if (runtime === 'php') return t('projects.runtimeName.php');
    if (runtime === 'node') return t('projects.runtimeName.node');
    if (runtime === 'static') return t('projects.runtimeName.static');
    if (runtime === 'python') return t('projects.runtimeName.python');
    if (runtime === 'go') return t('projects.runtimeName.go');
    if (runtime === 'rust') return t('projects.runtimeName.rust');
    if (runtime === 'java') return t('projects.runtimeName.java');
    if (runtime === 'kotlin') return t('projects.runtimeName.kotlin');
    if (runtime === 'bun') return t('projects.runtimeName.bun');
    return runtime ?? t('common.noneSelectedShort');
  }
  if (runtime === 'php') return 'PHP';
  if (runtime === 'node') return 'Node.js';
  if (runtime === 'static') return 'Static';
  if (runtime === 'python') return 'Python';
  if (runtime === 'go') return 'Go';
  if (runtime === 'rust') return 'Rust';
  if (runtime === 'java') return 'Java';
  if (runtime === 'kotlin') return 'Kotlin';
  if (runtime === 'bun') return 'Bun';
  return runtime ?? '—';
}
