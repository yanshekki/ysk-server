import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import {
  Badge,
  Button,
  Card,
  CardSection,
  CheckboxField,
  ConfirmDialog,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  PresetChips,
  SegRadio,
} from '../../../shared/components/ui';
import { projectsApi } from '../api';
import { ProjectSshCard } from './ProjectSshCard';

export interface ProjectResourcesTabProps {
  busy?: boolean;
  project: ProjectDto;
  quotaMb: string;
  setQuotaMb: (v: string) => void;
  memoryMax: string;
  setMemoryMax: (v: string) => void;
  cpuQuota: string;
  setCpuQuota: (v: string) => void;
  onSetQuota: () => void;
  onSetResources: () => void;
  onProvisionOs?: () => void;
  onOpsMessage?: (msg: string) => void;
  onProjectRefresh?: () => void | Promise<void>;
}

export function ProjectResourcesTab({
  busy,
  project,
  quotaMb,
  setQuotaMb,
  memoryMax,
  setMemoryMax,
  cpuQuota,
  setCpuQuota,
  onSetQuota,
  onSetResources,
  onProvisionOs,
  onOpsMessage,
  onProjectRefresh,
}: ProjectResourcesTabProps) {
  const { t } = useTranslation();
  const [tasksMax, setTasksMax] = useState(
    project.tasksMax != null ? String(project.tasksMax) : '512',
  );
  const [limitNofile, setLimitNofile] = useState(
    project.limitNofile != null ? String(project.limitNofile) : '4096',
  );
  const [shell, setShell] = useState(project.shell || '/usr/sbin/nologin');
  const [locked, setLocked] = useState(Boolean(project.accountLocked));
  const [localBusy, setLocalBusy] = useState(false);
  const [migrateConfirm, setMigrateConfirm] = useState(false);
  const [live, setLive] = useState<{
    userExists?: boolean;
    uid?: number;
    gid?: number;
    shellLive?: string;
    homeMode?: string;
    locked?: boolean | null;
    homeExists?: boolean;
    notes?: string[];
  } | null>(null);
  const anyBusy = Boolean(busy || localBusy);

  useEffect(() => {
    setTasksMax(project.tasksMax != null ? String(project.tasksMax) : '512');
    setLimitNofile(project.limitNofile != null ? String(project.limitNofile) : '4096');
    setShell(project.shell || '/usr/sbin/nologin');
    setLocked(Boolean(project.accountLocked));
  }, [
    project.id,
    project.tasksMax,
    project.limitNofile,
    project.shell,
    project.accountLocked,
  ]);

  useEffect(() => {
    void projectsApi
      .getOsUser(project.id)
      .then((r) => setLive(r.live))
      .catch(() => setLive(null));
  }, [project.id, project.osProvisioned, project.homeDir]);

  async function refreshLive() {
    try {
      const r = await projectsApi.getOsUser(project.id);
      setLive(r.live);
    } catch {
      /* ignore */
    }
  }

  async function saveAndApplyLimits() {
    setLocalBusy(true);
    try {
      const body = {
        shell: shell.trim() || '/usr/sbin/nologin',
        accountLocked: locked,
        memoryMax: memoryMax.trim() || undefined,
        cpuQuotaPercent: Number(cpuQuota) || undefined,
        tasksMax: Number(tasksMax) || undefined,
        limitNofile: Number(limitNofile) || undefined,
        quotaMb: Number(quotaMb) || undefined,
      };
      const r = await projectsApi.patchOsUser(project.id, body);
      const notes = r.notes?.join('；') ?? '';
      if (r.blocked) {
        onOpsMessage?.(
          t('projects.resWrittenOnly', { notes }),
        );
      } else if (r.applied) {
        onOpsMessage?.(t('projects.resAppliedOs', { notes }));
      } else {
        onOpsMessage?.(notes || (r.ok ? t('common.savedOk') : t('common.incomplete')));
      }
      await refreshLive();
      await onProjectRefresh?.();
    } catch (e) {
      onOpsMessage?.(e instanceof Error ? e.message : t('projects.resApplyLimitsFailed'));
    } finally {
      setLocalBusy(false);
    }
  }

  async function applyOnly() {
    setLocalBusy(true);
    try {
      const r = await projectsApi.applyOsLimits(project.id);
      onOpsMessage?.(r.notes?.join('；') || (r.ok ? t('common.applied') : t('common.incomplete')));
      await refreshLive();
    } catch (e) {
      onOpsMessage?.(e instanceof Error ? e.message : t('common.applyFailed'));
    } finally {
      setLocalBusy(false);
    }
  }

  async function chownHome() {
    setLocalBusy(true);
    try {
      const r = await projectsApi.chownOsHome(project.id);
      onOpsMessage?.(r.notes?.join('；') || (r.ok ? t('projects.resChownOk') : t('projects.resChownFailed')));
      await refreshLive();
    } catch (e) {
      onOpsMessage?.(e instanceof Error ? e.message : t('projects.resChownFailed'));
    } finally {
      setLocalBusy(false);
    }
  }

  return (
    <div className="tab-panel">
      <ProjectSshCard project={project} onMessage={onOpsMessage} />

      <Card>
        <CardSection
          title={t('projects.resOsTitle')}
          description={t('projects.resOsDesc')}
        >
          <FormLayout columns={2}>
            <Field label={t('security.ssh.linuxUser')} htmlFor="lu" flush>
              <input id="lu" value={project.linuxUser || '—'} readOnly disabled />
            </Field>
            <Field label={t('projects.resOsIsolation')} htmlFor="osok" flush>
              <input
                id="osok"
                value={project.osProvisioned ? t('ssl.status.ready') : t('projects.resOsNotCreated')}
                readOnly
                disabled
              />
            </Field>
            <Field label={t('projects.resHomeDir')} htmlFor="home" flush>
              <input id="home" value={project.homeDir || '—'} readOnly disabled />
            </Field>
            <Field label={t('projects.resCanonical')} htmlFor="canon" flush>
              <input
                id="canon"
                value={`/home/ysk-server-${project.id}`}
                readOnly
                disabled
              />
            </Field>
            <Field label="UID / GID" htmlFor="uid" flush>
              <input
                id="uid"
                value={
                  live?.userExists
                    ? `${live.uid ?? '—'} / ${live.gid ?? '—'}`
                    : live
                      ? t('projects.resUserMissing')
                      : '…'
                }
                readOnly
                disabled
              />
            </Field>
            <Field label={t('projects.resShellLive')} htmlFor="shlive" flush>
              <input
                id="shlive"
                value={
                  live
                    ? `${live.shellLive ?? '—'} · ${
                        live.locked === true
                          ? t('projects.resLocked')
                          : live.locked === false
                            ? t('projects.resUnlocked')
                            : '—'
                      }`
                    : '…'
                }
                readOnly
                disabled
              />
            </Field>
            <Field label={t('projects.resHomeMode')} htmlFor="hmode" flush>
              <input
                id="hmode"
                value={
                  live?.homeExists
                    ? t('projects.resHomeExists', { mode: live.homeMode ?? '?' })
                    : live
                      ? t('systemd.missing')
                      : '…'
                }
                readOnly
                disabled
              />
            </Field>
            <Field label={t('common.status')} htmlFor="st" flush>
              <div id="st" className="action-bar u-gap-2">
                <Badge tone={project.osProvisioned && live?.userExists ? 'ok' : 'warn'}>
                  {project.osProvisioned && live?.userExists ? t('projects.resIsolationOn') : t('projects.resIsolationPending')}
                </Badge>
              </div>
            </Field>
          </FormLayout>
          {live?.notes?.length ? (
            <FormHint>{live.notes.slice(0, 3).join('；')}</FormHint>
          ) : (
            <FormHint>
              {t('projects.resOsHint')}
            </FormHint>
          )}
          <FormActions>
            {onProvisionOs && !project.osProvisioned ? (
              <Button variant="primary" size="md" loading={anyBusy} onClick={onProvisionOs}>
                {t('projects.resProvisionUser')}
              </Button>
            ) : null}
            <Button variant="secondary" size="md" loading={anyBusy} onClick={() => void refreshLive()}>
              {t('protection.refreshStatus')}
            </Button>
            <Button variant="secondary" size="md" loading={anyBusy} onClick={() => void chownHome()}>
              {t('projects.resFixHome')}
            </Button>
            {project.homeDir !== `/home/ysk-server-${project.id}` || !project.osProvisioned ? (
              <Button
                variant="secondary"
                size="md"
                loading={anyBusy}
                onClick={() => setMigrateConfirm(true)}
              >
                {t('projects.resMigrateHome')}
              </Button>
            ) : null}
          </FormActions>
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title={t('projects.sectionQuota', { defaultValue: t('projects.sectionQuota') })}
          description={t('projects.resQuotaDesc')}
        >
          <FormLayout>
            <Field
              label={t('projects.quotaMb', { defaultValue: t('publicFiles.quotaMiB') })}
              htmlFor="qmb"
              hint={t('projects.resQuotaHint')}
              flush
            >
              <PresetChips
                options={[
                  { value: '512', label: '512' },
                  { value: '1024', label: '1G' },
                  { value: '2048', label: '2G' },
                  { value: '5120', label: '5G' },
                  { value: '10240', label: '10G' },
                  { value: '20480', label: '20G' },
                ]}
                value={quotaMb}
                onChange={setQuotaMb}
                allowCustom
                customPlaceholder="MiB"
              />
            </Field>
          </FormLayout>
          <FormActions>
            <Button variant="primary" size="md" loading={anyBusy} onClick={onSetQuota}>
              {t('projects.setQuota', { defaultValue: t('projects.resSetSoftQuota') })}
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title={t('projects.resLimitsTitle')}
          description={t('projects.resLimitsDesc')}
        >
          <FormLayout columns={2}>
            <Field label={t('projects.resMemMax')} htmlFor="mem" hint={t('projects.resMemHint')} flush>
              <PresetChips
                options={[
                  { value: '256M', label: '256M' },
                  { value: '512M', label: '512M' },
                  { value: '1G', label: '1G' },
                  { value: '2G', label: '2G' },
                  { value: '4G', label: '4G' },
                ]}
                value={memoryMax}
                onChange={setMemoryMax}
                allowCustom
                customPlaceholder={t('common.custom')}
              />
            </Field>
            <Field label={t('projects.cpuQuota')} htmlFor="cpuq" hint={t('projects.resCpuHint')} flush>
              <PresetChips
                options={[
                  { value: '25', label: '25%' },
                  { value: '50', label: '50%' },
                  { value: '100', label: '100%' },
                  { value: '200', label: '200%' },
                  { value: '400', label: '400%' },
                ]}
                value={cpuQuota}
                onChange={setCpuQuota}
                allowCustom
                customPlaceholder={t('projects.resCustomPct')}
              />
            </Field>
            <Field label="TasksMax" htmlFor="tmax" hint={t('projects.resTasksHint')} flush>
              <PresetChips
                options={[
                  { value: '128', label: '128' },
                  { value: '256', label: '256' },
                  { value: '512', label: '512' },
                  { value: '1024', label: '1024' },
                  { value: '4096', label: '4096' },
                ]}
                value={tasksMax}
                onChange={setTasksMax}
                allowCustom
                customPlaceholder={t('common.custom')}
              />
            </Field>
            <Field label="LimitNOFILE" htmlFor="nofile" hint={t('projects.resNofileHint')} flush>
              <PresetChips
                options={[
                  { value: '1024', label: '1024' },
                  { value: '4096', label: '4096' },
                  { value: '8192', label: '8192' },
                  { value: '65535', label: '65535' },
                ]}
                value={limitNofile}
                onChange={setLimitNofile}
                allowCustom
                customPlaceholder={t('common.custom')}
              />
            </Field>
            <Field label="Shell" htmlFor="shell" hint={t('projects.resShellHint')} flush>
              <SegRadio
                name="shell"
                aria-label="Shell"
                value={shell}
                onChange={setShell}
                options={[
                  { value: '/usr/sbin/nologin', label: 'nologin' },
                  { value: '/bin/false', label: 'false' },
                  { value: '/bin/bash', label: t('projects.resShellBashRisk') },
                ]}
              />
            </Field>
          </FormLayout>
          <div className="form-check-row u-mt-3">
            <CheckboxField
              id="alock"
              label={t('projects.resLockAccount')}
              description={t('projects.resLockDesc')}
              checked={locked}
              onChange={setLocked}
            />
          </div>
          <FormHint>
            {t('projects.resLimitsHint')}
          </FormHint>
          <FormActions>
            <Button
              variant="primary"
              size="md"
              loading={anyBusy}
              onClick={() => void saveAndApplyLimits()}
            >
              {t('projects.resSaveApply')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={anyBusy}
              onClick={() => {
                onSetResources();
              }}
            >
              {t('projects.resSaveControlOnly')}
            </Button>
            <Button variant="ghost" size="md" loading={anyBusy} onClick={() => void applyOnly()}>
              {t('projects.resReapply')}
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      <ConfirmDialog
        open={migrateConfirm}
        onClose={() => !localBusy && setMigrateConfirm(false)}
        onConfirm={() => {
          setMigrateConfirm(false);
          setLocalBusy(true);
          void projectsApi
            .migrateOsIsolation(project.id, { removePreviousHome: true })
            .then((r) => {
              onOpsMessage?.(
                (r.notes ?? []).join('；') ||
                  (r.ok ? t('projects.resMigrateDone') : t('projects.resMigrateIncomplete')),
              );
              return onProjectRefresh?.();
            })
            .catch((e: Error) => onOpsMessage?.(e.message))
            .finally(() => setLocalBusy(false));
        }}
        title={t('projects.resMigrateTitle')}
        description={t('projects.resMigrateDesc')}
        confirmLabel={t('projects.resMigrate')}
        cancelLabel={t('common.cancel')}
        danger
        busy={localBusy}
      />
    </div>
  );
}
