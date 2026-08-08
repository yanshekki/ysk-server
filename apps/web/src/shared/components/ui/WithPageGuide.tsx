/**
 * Wrap a non-tabbed page body with ops / software / about tabs.
 * SoftwareVersionBar + install banners belong in stackContent (not main).
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTab } from '../../hooks/usePageTab';
import { PageGuide } from './PageGuide';
import { PageTabs } from './PageTabs';

const TABS_MAIN_ABOUT = ['main', 'about'] as const;
const TABS_WITH_STACK = ['main', 'stack', 'about'] as const;

export type WithPageGuideProps = {
  guideId: string;
  children: ReactNode;
  /** Label for the primary content tab */
  mainLabel?: string;
  /**
   * Software version / install UI (e.g. SoftwareVersionBar).
   * When set, adds a 「軟件」tab like Email / Protection.
   */
  stackContent?: ReactNode;
  stackLabel?: string;
};

export function WithPageGuide({
  guideId,
  children,
  mainLabel,
  stackContent,
  stackLabel,
}: WithPageGuideProps) {
  const { t } = useTranslation();
  const hasStack = Boolean(stackContent);
  const tabIds = hasStack ? TABS_WITH_STACK : TABS_MAIN_ABOUT;
  const [tab, setTab] = usePageTab(tabIds, 'main');

  const tabs = [
    { id: 'main', label: mainLabel ?? t('tabs.main') },
    ...(hasStack
      ? [{ id: 'stack', label: stackLabel ?? t('tabs.stack') }]
      : []),
    { id: 'about', label: t('tabs.about') },
  ];

  return (
    <PageTabs tabs={tabs} active={tab} onChange={setTab} variant="scroll">
      {tab === 'main' ? <div className="tab-panel stack">{children}</div> : null}
      {hasStack && tab === 'stack' ? (
        <div className="tab-panel stack">{stackContent}</div>
      ) : null}
      {tab === 'about' ? <PageGuide guideId={guideId} /> : null}
    </PageTabs>
  );
}
