/**
 * Product-facing page guide (About tab).
 * Keep short: no essays on the main UI surface.
 */

export type PageGuideRelated = { label: string; to: string };

/**
 * Slim About-tab document (canonical).
 * Legacy fields (features / useCases / workflow / caveats) are still accepted
 * in JSON and normalized in `catalog.ts`.
 */
export type PageGuideDoc = {
  id: string;
  title: string;
  /** One sentence: what this page is for */
  summary: string;
  /** Up to 5 actions the operator can take */
  canDo: string[];
  /** Up to 4 caveats / limits */
  notes: string[];
  related?: PageGuideRelated[];

  /** @deprecated normalized into canDo */
  features?: Array<{ name: string; purpose: string; how?: string }>;
  /** @deprecated normalized into canDo */
  useCases?: string[];
  /** @deprecated normalized into canDo */
  workflow?: string[];
  /** @deprecated normalized into notes */
  caveats?: string[];
  /** @deprecated ignored in UI */
  audience?: string;
  /** @deprecated ignored in UI */
  chips?: string[];
};

/** Raw catalog entry before normalize */
export type PageGuideRaw = Partial<PageGuideDoc> & {
  id: string;
  title: string;
  summary: string;
};
