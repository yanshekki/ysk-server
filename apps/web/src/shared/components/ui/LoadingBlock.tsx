export interface LoadingBlockProps {
  label?: string;
}

/** Page-level loading strip — always a card with horizontal padding. */
export function LoadingBlock({ label = '載入中…' }: LoadingBlockProps) {
  return (
    <div className="card loading-row" role="status" aria-live="polite">
      <div className="spinner" aria-hidden />
      <span className="muted">{label}</span>
    </div>
  );
}
