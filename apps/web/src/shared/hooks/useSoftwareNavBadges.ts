/**
 * @deprecated Use useUpdatesNavBadge — software hub merged into /updates.
 * Kept as thin adapter so older tests/imports do not break during transition.
 */
export {
  useUpdatesNavBadge as useSoftwareNavBadges,
  type UpdatesNavBadge as SoftwareNavBadges,
} from './useUpdatesNavBadge';
