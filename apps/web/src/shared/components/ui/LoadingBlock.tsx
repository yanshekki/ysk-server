export interface LoadingBlockProps {
  label?: string;
}

export function LoadingBlock({ label = 'Loading…' }: LoadingBlockProps) {
  return (
    <div className="card loading-row">
      <div className="spinner" aria-hidden />
      <span className="muted">{label}</span>
    </div>
  );
}
