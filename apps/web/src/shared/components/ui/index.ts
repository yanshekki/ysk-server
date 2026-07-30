export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';

export { Card, CardHeader, CardSection } from './Card';
export type { CardProps, CardHeaderProps, CardSectionProps } from './Card';

export { Badge } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';

export { Alert } from './Alert';
export type { AlertProps, AlertVariant } from './Alert';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { Modal } from './Modal';
export type { ModalProps } from './Modal';

export { ConfirmDialog } from './ConfirmDialog';
export type { ConfirmDialogProps } from './ConfirmDialog';

/** Page-level tabs — prefer PageTabs; Tabs kept as alias */
export { PageTabs, Tabs } from './PageTabs';
export type { PageTabsProps, PageTabItem, TabsProps, TabItem } from './PageTabs';

export { KpiGrid, KpiCard } from './KpiCard';
export type { KpiCardProps, KpiGridCols } from './KpiCard';

export {
  Field,
  FormGrid,
  FormLayout,
  FormActions,
  CheckboxField,
  FormHint,
} from './Field';
export type { FieldProps, FormLayoutProps, FormActionsProps, CheckboxFieldProps } from './Field';

/** Form shell — pair with Field */
export { Form } from './Form';
export type { FormProps } from './Form';

/** Data table — only allowed table for feature pages */
export { DataTable } from './DataTable';
export type { DataTableProps, DataColumn } from './DataTable';

/** List shell (same create toolbar rule as DataTable) */
export { ListPanel } from './ListPanel';
export type { ListPanelProps } from './ListPanel';

/** Info boxes for runtime / entity status (not kpi-card) */
export { InfoCard, InfoCardGrid } from './InfoCard';
export type { InfoCardProps, InfoFact, InfoCardGridCols } from './InfoCard';

/** Button list — replace btn-row */
export { ActionBar } from './ActionBar';
export type { ActionBarProps, ActionBarAlign, ActionBarSize } from './ActionBar';

export { KeyValueList } from './KeyValueList';
export type { KeyValueListProps, KeyValueItem } from './KeyValueList';

export { CodeBlock, LogViewer } from './CodeBlock';
export type { CodeBlockProps, LogViewerProps } from './CodeBlock';

export { OpsResultPanel } from './OpsResultPanel';
export type { OpsResultPanelProps, OpsResultLike } from './OpsResultPanel';

export { SummaryStrip } from './SummaryStrip';
export type { SummaryStripProps, StatItem, StatTone } from './SummaryStrip';

export { LoadingBlock } from './LoadingBlock';
export type { LoadingBlockProps } from './LoadingBlock';

export { StructuredFacts } from './StructuredFacts';
export type { FactItem } from './StructuredFacts';

export { CapabilityBanner } from './CapabilityBanner';
export { PageGuide } from './PageGuide';
export type { PageGuideProps } from './PageGuide';

export { WithPageGuide } from './WithPageGuide';
export type { WithPageGuideProps } from './WithPageGuide';

export { FeaturePageLayout } from './FeaturePageLayout';
export type {
  FeaturePageLayoutProps,
  PageStatus,
  PageStatusItem,
} from './FeaturePageLayout';
export { FeatureIconGrid } from './FeatureIconGrid';
export type { FeatureIconGridProps, FeatureTileBadge } from './FeatureIconGrid';
/** @deprecated Prefer OpsResultPanel — ExecutionResultPanel is a thin adapter */
export { ExecutionResultPanel } from './ExecutionResultPanel';
export type { ExecutionResultProps, ExecutionStep } from './ExecutionResultPanel';
export { SoftwareInstallBanner } from './SoftwareInstallBanner';
export type { SoftwareInstallBannerProps } from './SoftwareInstallBanner';
export { Button, buttonClassName } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';
export { PromptDialog } from './PromptDialog';
export type { PromptDialogProps } from './PromptDialog';
export { SplitPanel } from './SplitPanel';
export type { SplitPanelProps } from './SplitPanel';
export { SettingField, SettingFieldList } from './SettingField';
export type { SettingFieldProps } from './SettingField';
export { DescriptionList } from './DescriptionList';
export type { DescriptionListProps, DescriptionItem } from './DescriptionList';

/** Internal — FeaturePageLayout owns page chrome; pages use status= */
export { PageStatusBar } from './PageStatusBar';
export type { PageStatusBarProps, PageStatusChip } from './PageStatusBar';
export { MultiCheckSelect } from './MultiCheckSelect';
export type { MultiCheckSelectProps, MultiCheckOption } from './MultiCheckSelect';
export { SegRadio } from './SegRadio';
export type { SegRadioProps, SegRadioOption } from './SegRadio';
export { PresetChips } from './PresetChips';
export type { PresetChipsProps, PresetChipOption } from './PresetChips';
