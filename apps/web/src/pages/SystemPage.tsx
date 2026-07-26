import { useTranslation } from 'react-i18next';
import { FeatureIconGrid, FeaturePageLayout } from '../shared/components/ui';
import { allFeatureTiles } from '../shared/nav/features';

/**
 * System index — feature launcher (not a god-page of mixed buttons).
 */
export function SystemPage() {
  const { t } = useTranslation();
  const tiles = allFeatureTiles()
    .filter((i) => i.to !== '/system')
    .map((i) => ({
      ...i,
      title: t(`nav.${i.key}`, { defaultValue: i.key }),
      description: t(`features.desc.${i.key}`, { defaultValue: '' }),
    }));

  return (
    <FeaturePageLayout
      title={t('system.indexTitle', { defaultValue: '系統工具' })}
      subtitle={t('system.indexSubtitle', {
        defaultValue: '每個功能有獨立頁面。請由下列磁貼或左側選單進入。',
      })}
      showCapability={false}
    >
      <FeatureIconGrid items={tiles} />
    </FeaturePageLayout>
  );
}
