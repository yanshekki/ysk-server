import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  collectExpandablePaths,
  JsonViewer,
  parseJsonInput,
  prettyJsonText,
} from './JsonViewer';

describe('parseJsonInput / prettyJsonText', () => {
  it('parses objects and JSON strings', () => {
    expect(parseJsonInput({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    expect(parseJsonInput('{"a":1}')).toEqual({ ok: true, data: { a: 1 } });
    expect(parseJsonInput('not json').ok).toBe(false);
  });

  it('pretty-prints with indent', () => {
    expect(prettyJsonText({ a: 1 })).toContain('\n');
    expect(prettyJsonText('{"a":1}')).toContain('"a"');
  });
});

describe('collectExpandablePaths', () => {
  it('stops at default depth 2', () => {
    const set = new Set<string>();
    collectExpandablePaths({ a: { b: { c: 1 } } }, '', 0, 2, set);
    expect(set.has('')).toBe(true);
    expect(set.has('a')).toBe(true);
    expect(set.has('a.b')).toBe(false);
  });
});

describe('JsonViewer', () => {
  it('renders a collapsible tree and expand/collapse controls', async () => {
    const user = userEvent.setup();
    render(<JsonViewer value={{ State: { Status: 'running', Nested: { x: 1 } } }} />);
    expect(screen.getByText('"State"')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expand all/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /collapse all/i }));
    expect(screen.queryByText('"Status"')).toBeNull();
  });

  it('falls back to plain text when JSON is invalid', () => {
    render(<JsonViewer value="not-json {" />);
    expect(screen.getByText(/not-json/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /expand all/i })).toBeNull();
  });
});
