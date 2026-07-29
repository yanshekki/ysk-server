import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import {
  Badge,
  Button,
  Card,
  CardSection,
  CheckboxField,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  PresetChips,
  SegRadio,
} from '../../../shared/components/ui';
import { projectsApi } from '../api';

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
          `已寫入控制面；OS 未套用（需 root）。${notes}`,
        );
      } else if (r.applied) {
        onOpsMessage?.(`限制已套用到 OS。${notes}`);
      } else {
        onOpsMessage?.(notes || (r.ok ? '已儲存' : '未完成'));
      }
      await refreshLive();
      await onProjectRefresh?.();
    } catch (e) {
      onOpsMessage?.(e instanceof Error ? e.message : '套用限制失敗');
    } finally {
      setLocalBusy(false);
    }
  }

  async function applyOnly() {
    setLocalBusy(true);
    try {
      const r = await projectsApi.applyOsLimits(project.id);
      onOpsMessage?.(r.notes?.join('；') || (r.ok ? '已套用' : '未完成'));
      await refreshLive();
    } catch (e) {
      onOpsMessage?.(e instanceof Error ? e.message : '套用失敗');
    } finally {
      setLocalBusy(false);
    }
  }

  async function chownHome() {
    setLocalBusy(true);
    try {
      const r = await projectsApi.chownOsHome(project.id);
      onOpsMessage?.(r.notes?.join('；') || (r.ok ? 'chown 完成' : 'chown 失敗'));
      await refreshLive();
    } catch (e) {
      onOpsMessage?.(e instanceof Error ? e.message : 'chown 失敗');
    } finally {
      setLocalBusy(false);
    }
  }

  return (
    <div className="tab-panel">
      <Card>
        <CardSection
          title="系統用戶隔離"
          description="每個專案獨立 Linux 用戶；意圖 home：/home/ysk-server-{專案 id}"
        >
          <FormLayout columns={2}>
            <Field label="Linux 用戶" htmlFor="lu" flush>
              <input id="lu" value={project.linuxUser || '—'} readOnly disabled />
            </Field>
            <Field label="OS 隔離" htmlFor="osok" flush>
              <input
                id="osok"
                value={project.osProvisioned ? '已就緒' : '未建立（需系統管理員）'}
                readOnly
                disabled
              />
            </Field>
            <Field label="Home 目錄" htmlFor="home" flush>
              <input id="home" value={project.homeDir || '—'} readOnly disabled />
            </Field>
            <Field label="意圖路徑" htmlFor="canon" flush>
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
                      ? '用戶不存在'
                      : '…'
                }
                readOnly
                disabled
              />
            </Field>
            <Field label="即時 shell / 鎖定" htmlFor="shlive" flush>
              <input
                id="shlive"
                value={
                  live
                    ? `${live.shellLive ?? '—'} · ${
                        live.locked === true
                          ? '已鎖定'
                          : live.locked === false
                            ? '未鎖定'
                            : '—'
                      }`
                    : '…'
                }
                readOnly
                disabled
              />
            </Field>
            <Field label="home 模式" htmlFor="hmode" flush>
              <input
                id="hmode"
                value={
                  live?.homeExists
                    ? `存在 · mode ${live.homeMode ?? '?'}`
                    : live
                      ? '不存在'
                      : '…'
                }
                readOnly
                disabled
              />
            </Field>
            <Field label="狀態" htmlFor="st" flush>
              <div id="st" className="btn-row u-gap-2">
                <Badge tone={project.osProvisioned && live?.userExists ? 'ok' : 'warn'}>
                  {project.osProvisioned && live?.userExists ? '隔離中' : '待隔離'}
                </Badge>
              </div>
            </Field>
          </FormLayout>
          {live?.notes?.length ? (
            <FormHint>{live.notes.slice(0, 3).join('；')}</FormHint>
          ) : (
            <FormHint>
              行程以專案用戶執行。建立系統用戶需 YSK_EXECUTE + root；否則為 degraded。
            </FormHint>
          )}
          <FormActions>
            {onProvisionOs && !project.osProvisioned ? (
              <Button variant="primary" size="md" loading={anyBusy} onClick={onProvisionOs}>
                建立／修復系統用戶
              </Button>
            ) : null}
            <Button variant="secondary" size="md" loading={anyBusy} onClick={() => void refreshLive()}>
              重新整理狀態
            </Button>
            <Button variant="secondary" size="md" loading={anyBusy} onClick={() => void chownHome()}>
              修復 home 擁有權
            </Button>
            {project.homeDir !== `/home/ysk-server-${project.id}` || !project.osProvisioned ? (
              <Button
                variant="secondary"
                size="md"
                loading={anyBusy}
                onClick={() => {
                  if (
                    !window.confirm(
                      '將遷移到 /home/ysk-server-{id} 並建立／修復系統用戶。需 root。繼續？',
                    )
                  ) {
                    return;
                  }
                  setLocalBusy(true);
                  void projectsApi
                    .migrateOsIsolation(project.id, { removePreviousHome: true })
                    .then((r) => {
                      onOpsMessage?.(
                        (r.notes ?? []).join('；') ||
                          (r.ok ? '遷移完成' : '遷移未完成'),
                      );
                      return onProjectRefresh?.();
                    })
                    .catch((e: Error) => onOpsMessage?.(e.message))
                    .finally(() => setLocalBusy(false));
                }}
              >
                遷移到 /home/ysk-server-…
              </Button>
            ) : null}
          </FormActions>
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title={t('projects.sectionQuota', { defaultValue: '磁碟配額' })}
          description="軟配額（deploy 前 du 擋）+ 有 setquota 時可硬強制"
        >
          <FormLayout>
            <Field
              label={t('projects.quotaMb', { defaultValue: '配額（MiB）' })}
              htmlFor="qmb"
              hint="例如 1024 = 1 GiB"
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
              {t('projects.setQuota', { defaultValue: '儲存軟配額' })}
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title="行程與帳號限制"
          description="systemd MemoryMax / CPUQuota / TasksMax / NOFILE + shell／鎖定"
        >
          <FormLayout columns={2}>
            <Field label="記憶體上限" htmlFor="mem" hint="例如 512M 或 1G" flush>
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
                customPlaceholder="自訂"
              />
            </Field>
            <Field label="CPU 配額 %" htmlFor="cpuq" hint="100 = 一顆 CPU" flush>
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
                customPlaceholder="自訂 %"
              />
            </Field>
            <Field label="TasksMax" htmlFor="tmax" hint="行程數上限" flush>
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
                customPlaceholder="自訂"
              />
            </Field>
            <Field label="LimitNOFILE" htmlFor="nofile" hint="開檔上限" flush>
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
                customPlaceholder="自訂"
              />
            </Field>
            <Field label="Shell" htmlFor="shell" hint="預設 nologin" flush>
              <SegRadio
                name="shell"
                aria-label="Shell"
                value={shell}
                onChange={setShell}
                options={[
                  { value: '/usr/sbin/nologin', label: 'nologin' },
                  { value: '/bin/false', label: 'false' },
                  { value: '/bin/bash', label: 'bash · 風險' },
                ]}
              />
            </Field>
          </FormLayout>
          <div className="form-check-row u-mt-3">
            <CheckboxField
              id="alock"
              label="鎖定 Linux 帳號"
              description="usermod -L；解鎖時取消勾選"
              checked={locked}
              onChange={setLocked}
            />
          </div>
          <FormHint>
            「儲存並套用」會寫 DB 並嘗試 usermod / setquota / systemctl set-property。無權限時只寫控制面。
          </FormHint>
          <FormActions>
            <Button
              variant="primary"
              size="md"
              loading={anyBusy}
              onClick={() => void saveAndApplyLimits()}
            >
              儲存並套用限制到 OS
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={anyBusy}
              onClick={() => {
                onSetResources();
              }}
            >
              僅存 Mem/CPU 到控制面
            </Button>
            <Button variant="ghost" size="md" loading={anyBusy} onClick={() => void applyOnly()}>
              再套用一次（不改表單）
            </Button>
          </FormActions>
        </CardSection>
      </Card>
    </div>
  );
}
