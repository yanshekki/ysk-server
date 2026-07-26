import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import { Button, Card, CardSection, Field } from '../../../shared/components/ui';
import { getProjectUiProfile } from '../model/runtime-ui';
import { projectsApi } from '../api';

export interface ProjectDeployTabProps {
  project: ProjectDto;
  busy?: boolean;
  gitUrl: string;
  setGitUrl: (v: string) => void;
  envText: string;
  setEnvText: (v: string) => void;
  onDeploy: () => void;
  onGitDeploy: () => void;
  onSaveEnv: () => void;
  onPhpVersionChange?: (v: string) => void;
  onOpsMessage?: (msg: string) => void;
}

export function ProjectDeployTab({
  project,
  busy,
  gitUrl,
  setGitUrl,
  envText,
  setEnvText,
  onDeploy,
  onGitDeploy,
  onSaveEnv,
  onPhpVersionChange,
  onOpsMessage,
}: ProjectDeployTabProps) {
  const { t } = useTranslation();
  const ui = getProjectUiProfile(project.runtime);
  const [phpVer, setPhpVer] = useState(project.runtimeVersion ?? '8.2');
  const [phpBusy, setPhpBusy] = useState(false);

  return (
    <Card>
      {ui.showDeploy ? (
        <CardSection
          title={
            ui.deployIsPhp
              ? t('projects.sectionPhpDeploy')
              : t('projects.sectionRuntimeDeploy')
          }
          description={
            ui.deployIsPhp
              ? t('projects.sectionPhpDeployDesc')
              : t('projects.sectionRuntimeDeployDesc')
          }
        >
          {ui.deployIsPhp ? (
            <Field label="PHP 版本（per-site）" htmlFor="php-ver" flush>
              <select
                id="php-ver"
                value={phpVer}
                onChange={(e) => {
                  setPhpVer(e.target.value);
                  onPhpVersionChange?.(e.target.value);
                }}
              >
                <option value="8.1">8.1</option>
                <option value="8.2">8.2</option>
                <option value="8.3">8.3</option>
              </select>
            </Field>
          ) : null}
          <div className="btn-row u-mt-3">
            <Button variant="primary" size="md" loading={busy} onClick={onDeploy}>
              {ui.deployIsPhp ? t('projects.deployPhp') : t('projects.deploy')}
            </Button>
            {ui.deployIsPhp ? (
              <Button
                variant="secondary"
                size="md"
                loading={phpBusy || busy}
                onClick={() => {
                  setPhpBusy(true);
                  void projectsApi
                    .applyPhpFpm(project.id, { phpVersion: phpVer, enable: true })
                    .then((r) => {
                      const notes = (r as { notes?: string[] }).notes;
                      onOpsMessage?.(
                        notes?.join('；') ??
                          ((r as { ok?: boolean }).ok ? '已套用 PHP-FPM pool' : 'FPM 未完成'),
                      );
                    })
                    .catch((e: Error) => onOpsMessage?.(e.message))
                    .finally(() => setPhpBusy(false));
                }}
              >
                套用 FPM pool
              </Button>
            ) : null}
          </div>
        </CardSection>
      ) : (
        <CardSection
          title={t('projects.sectionStaticDeploy')}
          description={t('projects.sectionStaticDeployDesc')}
        >
          <p className="muted">{t('projects.staticDeployHint')}</p>
        </CardSection>
      )}

      {ui.showGit ? (
        <CardSection title={t('projects.sectionGit')} description={t('projects.sectionGitDesc')}>
          <Field label={t('projects.gitUrl')} techKey="git_url" htmlFor="giturl">
            <input
              id="giturl"
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder="https://github.com/org/repo.git"
            />
          </Field>
          <div className="btn-row">
            <Button variant="secondary" size="md" loading={busy} onClick={onGitDeploy} >
              {t('projects.gitDeploy')}
            </Button>
          </div>
        </CardSection>
      ) : null}

      {ui.showEnv ? (
        <CardSection title={t('projects.sectionEnv')} description={t('projects.sectionEnvDesc')}>
          <Field label={t('projects.envFile')} techKey=".env" htmlFor="penv">
            <textarea
              id="penv"
              rows={6}
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
            />
          </Field>
          <div className="btn-row">
            <Button variant="secondary" size="md" loading={busy} onClick={onSaveEnv}>
              {t('projects.saveEnv')}
            </Button>
          </div>
        </CardSection>
      ) : null}
    </Card>
  );
}
