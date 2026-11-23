/**
 * i18next 27 type options for the panel.
 * Runtime catalogs stay JSON (no typed `resources`); keep v26 string-key t()
 * assignability so helpers typed as `(key, opts?) => string` still accept TFunction.
 */
import 'i18next';

declare module 'i18next' {
  interface CustomTypeOptions {
    enableSelector: false;
    returnEmptyString: true;
    strictInterpolationChecks: false;
  }
}
