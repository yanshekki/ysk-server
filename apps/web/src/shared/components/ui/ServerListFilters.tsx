/**
 * Drop-in ListToolbar wired for useServerList-shaped state.
 * Prefer this over hand-rolled search inputs on feature tables.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ListToolbar, type ListToolbarChipGroup } from './ListToolbar';

export type ServerListFiltersProps = {
  q: string;
  setQ: (v: string) => void;
  searching?: boolean;
  loading?: boolean;
  total?: number;
  shown?: number;
  activeFilterCount: number;
  clear: () => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  chipGroups?: ListToolbarChipGroup[];
  extra?: ReactNode;
  className?: string;
};

export function ServerListFilters(props: ServerListFiltersProps) {
  const { t } = useTranslation();
  return (
    <ListToolbar
      search={props.q}
      onSearchChange={props.setQ}
      searchPlaceholder={
        props.searchPlaceholder ?? t('listToolbar.searchPlaceholder')
      }
      searchAriaLabel={props.searchAriaLabel ?? t('listToolbar.searchAria')}
      searching={props.searching}
      loading={props.loading}
      total={props.total}
      shown={props.shown}
      activeFilterCount={props.activeFilterCount}
      onClear={props.clear}
      chipGroups={props.chipGroups}
      extra={props.extra}
      className={props.className}
    />
  );
}
