/**
 * Wrap a non-tabbed page body with trailing「說明」tab.
 */
import type { ReactNode } from 'react';
import { usePageTab } from '../../hooks/usePageTab';
import { PageGuide } from './PageGuide';
import { PageTabs } from './PageTabs';

const TABS = ['main', 'about'] as const;

export type WithPageGuideProps = {
  guideId: string;
  children: ReactNode;
  /** Label for the primary content tab (default 操作) */
  mainLabel?: string;
};

export function WithPageGuide({
  guideId,
  children,
  mainLabel = '操作',
}: WithPageGuideProps) {
  const [tab, setTab] = usePageTab(TABS, 'main');
  return (
    <PageTabs
      tabs={[
        { id: 'main', label: mainLabel },
        { id: 'about', label: '說明' },
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
