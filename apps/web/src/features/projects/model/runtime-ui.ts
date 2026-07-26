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
  // node (default)
  return {
    runtime: 'node',
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
    processLabelFallback: 'Process',
  };
}
