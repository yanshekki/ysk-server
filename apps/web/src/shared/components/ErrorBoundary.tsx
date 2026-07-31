/**
 * Top-level React error boundary — prevents full white screen on render crashes.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** Optional title override */
  title?: string;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[YSK] UI crash', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans TC", sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: '100%',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: '1.5rem 1.75rem',
            boxShadow: '0 8px 24px rgba(15,23,42,0.06)',
          }}
        >
          <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.15rem' }}>
            {this.props.title ?? 'Panel error'}
          </h1>
          <p style={{ margin: '0 0 1rem', color: '#64748b', fontSize: '0.9rem' }}>
            Something broke while rendering. Reload the page. If it keeps happening,
            check the browser console and server logs.
          </p>
          <pre
            style={{
              margin: '0 0 1rem',
              padding: '0.75rem',
              background: '#f1f5f9',
              borderRadius: 8,
              fontSize: '0.75rem',
              overflow: 'auto',
              maxHeight: 160,
            }}
          >
            {error.message}
          </pre>
          <button
            type="button"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
            style={{
              appearance: 'none',
              border: 'none',
              borderRadius: 8,
              background: '#3b82f6',
              color: '#fff',
              fontWeight: 600,
              padding: '0.55rem 1rem',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
