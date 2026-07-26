import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardSection,
  Field,
  FormActions,
  FormHint,
  FormLayout,
} from '../../../shared/components/ui';

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
    <div className="tab-panel">
      <Card>
        <CardSection
          title={t('projects.sectionQuota', { defaultValue: '磁碟配額' })}
          description={t('projects.sectionQuotaDesc', {
            defaultValue: '限制本專案可用磁碟空間（MiB）',
          })}
        >
          <FormLayout>
            <Field
              label={t('projects.quotaMb', { defaultValue: '配額（MiB）' })}
              htmlFor="qmb"
              hint="例如 1024 = 1 GiB；需系統配額工具才真正強制"
              flush
            >
              <input
                id="qmb"
                inputMode="numeric"
                value={quotaMb}
                onChange={(e) => setQuotaMb(e.target.value)}
                placeholder="1024"
              />
            </Field>
          </FormLayout>
          <FormActions>
            <Button variant="primary" size="md" loading={busy} onClick={onSetQuota}>
              {t('projects.setQuota', { defaultValue: '套用配額' })}
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title={t('projects.sectionLimits', { defaultValue: '行程資源上限' })}
          description={t('projects.sectionLimitsDesc', {
            defaultValue: 'systemd MemoryMax / CPUQuota（Node 等行程適用）',
          })}
        >
          <FormLayout columns={2}>
            <Field
              label={t('projects.memoryMax', { defaultValue: '記憶體上限' })}
              htmlFor="mem"
              hint="例如 512M 或 1G"
              flush
            >
              <input
                id="mem"
                value={memoryMax}
                onChange={(e) => setMemoryMax(e.target.value)}
                placeholder="512M"
              />
            </Field>
            <Field
              label={t('projects.cpuQuota', { defaultValue: 'CPU 配額 %' })}
              htmlFor="cpuq"
              hint="100 = 一顆 CPU 的 100%"
              flush
            >
              <input
                id="cpuq"
                inputMode="numeric"
                value={cpuQuota}
                onChange={(e) => setCpuQuota(e.target.value)}
                placeholder="100"
              />
            </Field>
          </FormLayout>
          <FormHint>真正生效需部署後的 systemd unit 支援，並有系統變更權限。</FormHint>
          <FormActions>
            <Button variant="primary" size="md" loading={busy} onClick={onSetResources}>
              {t('projects.setResources', { defaultValue: '套用資源上限' })}
            </Button>
          </FormActions>
        </CardSection>
      </Card>
    </div>
  );
}
