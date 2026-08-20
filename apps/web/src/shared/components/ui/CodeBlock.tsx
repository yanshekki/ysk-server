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
