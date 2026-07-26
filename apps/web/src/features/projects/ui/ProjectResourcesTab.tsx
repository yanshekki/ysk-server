import { useTranslation } from 'react-i18next';
import { Button, Card, CardSection, Field, FormGrid } from '../../../shared/components/ui';

export interface ProjectResourcesTabProps {
  busy?: boolean;
  quotaMb: string;
  setQuotaMb: (v: string) => void;
  memoryMax: string;
  setMemoryMax: (v: string) => void;
  cpuQuota: string;
  setCpuQuota: (v: string) => void;
  onSetQuota: () => void;
  onSetResources: () => void;
}

export function ProjectResourcesTab({
  busy,
  quotaMb,
  setQuotaMb,
  memoryMax,
  setMemoryMax,
  cpuQuota,
  setCpuQuota,
  onSetQuota,
  onSetResources,
}: ProjectResourcesTabProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardSection title={t('projects.sectionQuota')} description={t('projects.sectionQuotaDesc')}>
        <FormGrid>
          <Field label={t('projects.quotaMb')} techKey="quota_mb" htmlFor="qmb" flush>
            <input id="qmb" value={quotaMb} onChange={(e) => setQuotaMb(e.target.value)} />
          </Field>
        </FormGrid>
        <div className="form-actions btn-row">
          <Button variant="secondary" size="md" loading={busy} onClick={onSetQuota}>
            {t('projects.setQuota')}
          </Button>
        </div>
      </CardSection>

      <CardSection
        title={t('projects.sectionLimits')}
        description={t('projects.sectionLimitsDesc')}
      >
        <FormGrid>
          <Field label={t('projects.memoryMax')} techKey="MemoryMax" htmlFor="mem" flush>
            <input id="mem" value={memoryMax} onChange={(e) => setMemoryMax(e.target.value)} />
          </Field>
          <Field label={t('projects.cpuQuota')} techKey="CPUQuota" htmlFor="cpuq" flush>
            <input id="cpuq" value={cpuQuota} onChange={(e) => setCpuQuota(e.target.value)} />
          </Field>
        </FormGrid>
        <div className="form-actions btn-row">
          <Button variant="secondary" size="md" loading={busy} onClick={onSetResources} >
            {t('projects.setResources')}
          </Button>
        </div>
      </CardSection>
    </Card>
  );
}
