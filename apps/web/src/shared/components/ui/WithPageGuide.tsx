/**
 * Wrap a non-tabbed page body with trailing about tab.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTab } from '../../hooks/usePageTab';
import { PageGuide } from './PageGuide';
import { PageTabs } from './PageTabs';

const TABS = ['main', 'about'] as const;

export type WithPageGuideProps = {
  guideId: string;
  children: ReactNode;
  /** Label for the primary content tab */
  mainLabel?: string;
};

export function WithPageGuide({
  guideId,
  children,
  mainLabel }: WithPageGuideProps) {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'main');
  return (
    <PageTabs
      tabs={[
        { id: 'main', label: mainLabel ?? t('tabs.main') },
        { id: 'about', label: t('tabs.about') },
      ]}
      active={tab}
      onChange={setTab}
      variant="scroll"
    >
      {tab === 'main' ? <div className="tab-panel">{children}</div> : null}
      {tab === 'about' ? <PageGuide guideId={guideId} /> : null}
    </PageTabs>
  );
}
