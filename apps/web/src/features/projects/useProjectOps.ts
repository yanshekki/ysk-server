import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OpsApplyResultDto } from '@ysk/shared';
import { projectsApi } from './api';
import { formatOpsMessage, parseEnvText, type ProjectOpsAction } from './model/ops';
import { toast } from '../../shared/stores/toast-store';

export function useProjectOps(onSuccess?: () => void | Promise<void>) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  /** Page-level banners unused — operation feedback is toast-only. */
  const [error, setErrorRaw] = useState<string | null>(null);
  const [msg, setMsgRaw] = useState<string | null>(null);
  const setMsg = useCallback((m: string | null) => {
    if (m) toast.ok(m);
    setMsgRaw(null);
  }, []);
  const setError = useCallback((m: string | null) => {
    if (m) toast.error(m);
    setErrorRaw(null);
  }, []);
  const [opsLog, setOpsLog] = useState<OpsApplyResultDto | null>(null);

  const clearFeedback = useCallback(() => {
    setErrorRaw(null);
    setMsgRaw(null);
  }, []);

  const run = useCallback(
    async (
      action: ProjectOpsAction,
      id: string,
      opts?: {
        gitUrl?: string;
        envText?: string;
        quotaMb?: number;
        memoryMax?: string;
        cpuQuotaPercent?: number;
        phpVersion?: string;
        entry?: string;
        skipBuild?: boolean;
        enableSystemd?: boolean;
      },
    ) => {
      setBusy(true);
      setErrorRaw(null);
      setMsgRaw(null);
      try {
        let result: OpsApplyResultDto;
        switch (action) {
          case 'deploy':
            result = await projectsApi.deploy(id, {
              entry: opts?.entry || undefined,
              skipBuild: opts?.skipBuild,
              enableSystemd: opts?.enableSystemd,
            });
            break;
          case 'deploy-php':
            result = (await projectsApi.deployPhp(id, {
              phpVersion: opts?.phpVersion,
              preferFpm: true,
            })) as OpsApplyResultDto;
            break;
          case 'stop':
            result = await projectsApi.stop(id);
            break;
          case 'health':
            result = await projectsApi.health(id);
            break;
          case 'publish-nginx':
            result = await projectsApi.publishNginx(id);
            break;
          case 'publish-nginx-ssl':
            result = await projectsApi.publishNginx(id, { ssl: true });
            break;
          case 'suspend':
            result = await projectsApi.suspend(id);
            break;
          case 'unsuspend':
            result = await projectsApi.unsuspend(id);
            break;
          case 'git-deploy':
            result = await projectsApi.gitDeploy(id, {
              gitUrl: opts?.gitUrl || undefined,
              redeploy: true,
              entry: opts?.entry,
              skipBuild: opts?.skipBuild,
            });
            break;
          case 'backup':
            result = await projectsApi.backup(id);
            break;
          case 'env':
            result = await projectsApi.setEnv(id, parseEnvText(opts?.envText ?? ''));
            break;
          case 'quota':
            result = await projectsApi.setQuota(id, opts?.quotaMb ?? 1024);
            break;
          case 'resources':
            result = await projectsApi.setResources(id, {
              memoryMax: opts?.memoryMax,
              cpuQuotaPercent: opts?.cpuQuotaPercent,
            });
            break;
          case 'wordpress': {
            const r = await projectsApi.wordpressDownload(id);
            result = r as unknown as OpsApplyResultDto;
            break;
          }
          default:
            throw new Error(`Unknown action: ${action}`);
        }
        setOpsLog(result);
        toast.ok(formatOpsMessage(action, result, t));
        await onSuccess?.();
        return result;
      } catch (err) {
        const m = err instanceof Error ? err.message : `${action} failed`;
        toast.error(m);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [onSuccess, t],
  );

  return { busy, setBusy, error, setError, msg, setMsg, opsLog, setOpsLog, run, clearFeedback };
}
