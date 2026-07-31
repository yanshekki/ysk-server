import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('unit-test-crash');
}

describe('ErrorBoundary', () => {
  it('renders children when healthy', () => {
    render(
      <ErrorBoundary>
        <span>ok-child</span>
      </ErrorBoundary>,
    );
    expect(screen.getByText('ok-child')).toBeInTheDocument();
  });

  it('shows crash UI and does not claim success', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary title="Panel error">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Panel error')).toBeInTheDocument();
    expect(screen.getByText(/unit-test-crash/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
    spy.mockRestore();
  });
});
