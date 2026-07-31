import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResourceStatusBadge } from './ResourceStatusBadge';

describe('ResourceStatusBadge', () => {
  it('renders written honesty label (not bare Success)', () => {
    render(<ResourceStatusBadge status="written" />);
    expect(screen.getByText(/written/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Success$/)).not.toBeInTheDocument();
  });

  it('renders applied / pending_execute / failed tones', () => {
    const { rerender } = render(<ResourceStatusBadge status="applied" />);
    expect(screen.getByText(/applied/i)).toBeInTheDocument();

    rerender(<ResourceStatusBadge status="pending_execute" />);
    expect(screen.getByText(/execute|host/i)).toBeInTheDocument();

    rerender(<ResourceStatusBadge status="failed" />);
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });

  it('defaults draft when status missing', () => {
    render(<ResourceStatusBadge status={null} />);
    expect(screen.getByText(/draft/i)).toBeInTheDocument();
  });

  it('passes through unknown status text', () => {
    render(<ResourceStatusBadge status="custom-state" />);
    expect(screen.getByText('custom-state')).toBeInTheDocument();
  });

  it('covers planned / uploaded / issued / missing mapped keys', () => {
    const { rerender, container } = render(<ResourceStatusBadge status="planned" />);
    // i18n may translate planned → "In progress"
    expect(container.textContent?.length).toBeGreaterThan(0);
    expect(container.querySelector('.badge')).toBeTruthy();

    rerender(<ResourceStatusBadge status="uploaded" />);
    expect(container.querySelector('.badge')?.textContent).toBeTruthy();

    rerender(<ResourceStatusBadge status="issued" />);
    expect(container.querySelector('.badge')?.textContent).toBeTruthy();

    rerender(<ResourceStatusBadge status="missing" />);
    expect(container.querySelector('.badge')?.textContent).toBeTruthy();

    rerender(<ResourceStatusBadge status="DRAFT" />);
    expect(container.querySelector('.badge')?.textContent).toMatch(/draft/i);

    rerender(<ResourceStatusBadge status={undefined} />);
    expect(container.querySelector('.badge')?.textContent).toMatch(/draft/i);
  });
});
