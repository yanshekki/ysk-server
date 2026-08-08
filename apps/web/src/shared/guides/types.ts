/**
 * Product-facing page guide (About tab).
 * Professional structured help — scannable, not essays.
 */

export type PageGuideRelated = { label: string; to: string };

/**
 * Canonical About-tab document.
 * Legacy fields still accepted in JSON and normalized in catalog.ts.
 */
export type PageGuideDoc = {
  id: string;
  title: string;
  /** One sentence: what this page is for */
  summary: string;
  /** Up to 6 actions the operator can take */
  canDo: string[];
  /** Optional short recommended flow (max 5) */
  workflow?: string[];
  /** Up to 5 caveats / limits */
  notes: string[];
  /** Optional CLI one-liners (max 6) */
  cliHints?: string[];
  related?: PageGuideRelated[];

  /** @deprecated normalized into canDo */
  features?: Array<{ name: string; purpose: string; how?: string }>;
  /** @deprecated normalized into canDo */
  useCases?: string[];
  /** @deprecated normalized into workflow */
  workflowLegacy?: string[];
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
  /** legacy alias for workflow */
  steps?: string[];
};
