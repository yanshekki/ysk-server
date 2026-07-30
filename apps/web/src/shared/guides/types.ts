/**
 * Product-facing page guide content (operator documentation).
 * No PR / roadmap / development progress.
 */

export type PageGuideFeature = {
  name: string;
  purpose: string;
  how?: string;
};

export type PageGuideDoc = {
  /** Catalog id — usually nav key */
  id: string;
  title: string;
  /** One-line positioning */
  summary: string;
  /** Who this is for */
  audience?: string;
  /** Optional badge chips under hero */
  chips?: string[];
  features: PageGuideFeature[];
  useCases: string[];
  workflow: string[];
  caveats: string[];
  related?: Array<{ label: string; to: string }>;
};
