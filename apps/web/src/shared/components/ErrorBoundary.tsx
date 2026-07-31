/**
 * Top-level React error boundary — prevents full white screen on render crashes.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import './ErrorBoundary.css';

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
      <div className="ysk-error-boundary">
        <div className="ysk-error-boundary__card">
          <h1 className="ysk-error-boundary__title">
            {this.props.title ?? 'Panel error'}
          </h1>
          <p className="ysk-error-boundary__msg">
            Something broke while rendering. Reload the page. If it keeps happening,
            check the browser console and server logs.
          </p>
          <pre className="ysk-error-boundary__pre">{error.message}</pre>
          <button
            type="button"
            className="ysk-error-boundary__btn"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
