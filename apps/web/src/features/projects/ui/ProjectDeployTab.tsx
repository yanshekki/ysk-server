import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import { Button, Card, CardSection, Field } from '../../../shared/components/ui';
import { getProjectUiProfile } from '../model/runtime-ui';

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
}: ProjectDeployTabProps) {
  const { t } = useTranslation();
  const ui = getProjectUiProfile(project.runtime);

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
          <div className="btn-row">
            <Button variant="primary" size="md" loading={busy} onClick={onDeploy}>
              {ui.deployIsPhp ? t('projects.deployPhp') : t('projects.deploy')}
            </Button>
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
