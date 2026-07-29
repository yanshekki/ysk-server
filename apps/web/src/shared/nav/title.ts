/**
 * Page titles must match sidebar menu labels (nav.*).
 */
import type { TFunction } from 'i18next';

export function navTitle(key: string, t: TFunction): string {
  return t(`nav.${key}`, { defaultValue: key });
}
