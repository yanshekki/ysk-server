export interface CodeBlockProps {
  children: string;
  maxHeight?: boolean;
  spaced?: boolean;
}

export function CodeBlock({ children, spaced }: CodeBlockProps) {
  return (
    <pre className={spaced ? 'code code--spaced' : 'code'}>{children}</pre>
  );
}

export interface LogViewerProps {
  text: string;
  emptyLabel?: string;
}

export function LogViewer({ text, emptyLabel = '—' }: LogViewerProps) {
  if (!text) {
    return <p className="muted">{emptyLabel}</p>;
  }
  return <pre className="code code--spaced">{text}</pre>;
}
