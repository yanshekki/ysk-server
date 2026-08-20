import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { classifyLine, isPublicIp, LogViewer } from './LogViewer';

function wrap(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('classifyLine / isPublicIp', () => {
  it('classifies severity keywords', () => {
    expect(classifyLine('ERROR boom')).toBe('error');
    expect(classifyLine('warn: disk')).toBe('warn');
    expect(classifyLine('info ok')).toBe('info');
    expect(classifyLine('debug trace')).toBe('debug');
    expect(classifyLine('hello')).toBe('plain');
  });

  it('rejects private IPs', () => {
    expect(isPublicIp('203.0.113.10')).toBe(true);
    expect(isPublicIp('10.0.0.1')).toBe(false);
    expect(isPublicIp('192.168.1.1')).toBe(false);
    expect(isPublicIp('127.0.0.1')).toBe(false);
  });
});

describe('LogViewer', () => {
  it('renders numbered lines and a public IP link', () => {
    wrap(<LogViewer text={'ERROR boom\ninfo ok\n203.0.113.10 connected'} />);
    expect(screen.getByText(/ERROR boom/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '203.0.113.10' })).toHaveAttribute(
      'href',
      '/protection?tab=bans&ip=203.0.113.10',
    );
  });

  it('filters by keyword', async () => {
    const user = userEvent.setup();
    wrap(<LogViewer text={'ERROR boom\ninfo ok\nwarn disk'} />);
    await user.type(screen.getByPlaceholderText(/keyword|關鍵字/i), 'boom');
    expect(screen.getByRole('log')).toHaveTextContent(/ERROR boom/);
    expect(screen.getByRole('log')).not.toHaveTextContent(/warn disk/);
  });

  it('toggles wrap class', async () => {
    const user = userEvent.setup();
    const { container } = wrap(<LogViewer text={'a very long line'} />);
    expect(container.querySelector('.log-viewer--wrap')).toBeNull();
    await user.click(screen.getByRole('button', { name: /wrap|換行/i }));
    expect(container.querySelector('.log-viewer--wrap')).toBeTruthy();
  });

  it('shows empty label', () => {
    wrap(<LogViewer text="" emptyLabel="nothing here" />);
    expect(screen.getByText('nothing here')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /wrap|換行/i })).toBeTruthy();
  });

  it('hides toolbar when requested', () => {
    wrap(<LogViewer text="line" toolbar={false} />);
    expect(screen.queryByRole('button', { name: /wrap|換行/i })).toBeNull();
    expect(screen.getByText('line')).toBeInTheDocument();
  });

  it('accepts lines[] without join/split', () => {
    wrap(<LogViewer lines={['alpha', { text: 'beta panic', level: 'error' }]} />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta panic')).toBeInTheDocument();
  });

  it('calls onFollowChange from Follow', async () => {
    const user = userEvent.setup();
    const onFollowChange = vi.fn();
    wrap(<LogViewer text="x" follow={false} onFollowChange={onFollowChange} />);
    await user.click(screen.getByRole('button', { name: /follow|跟隨/i }));
    expect(onFollowChange).toHaveBeenCalledWith(true);
  });
});
