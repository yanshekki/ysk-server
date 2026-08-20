import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CodeEditor } from './CodeEditor';

const YAML = `services:
  node:
    image: avaplatform/avalanchego:v1.13.5
`;

describe('CodeEditor', () => {
  it('renders YAML highlight, line numbers, and language status', () => {
    render(
      <CodeEditor
        id="val-compose"
        value={YAML}
        filename="compose.yml"
        ariaLabel="Compose file"
        onChange={() => {}}
      />,
    );
    const root = screen.getByTestId('code-editor');
    expect(root.getAttribute('data-lang')).toBe('yaml');
    expect(screen.getByLabelText('Compose file')).toHaveValue(YAML);
    expect(root.querySelector('.fm-vscode__highlight')?.innerHTML).toContain('tok-attr');
    expect(root.querySelector('.fm-vscode__gutter')?.textContent).toMatch(/1/);
    expect(root.textContent).toMatch(/YAML/);
  });

  it('Tab indents and notifies onChange', () => {
    const onChange = vi.fn();
    render(<CodeEditor value="ab" filename="compose.yml" onChange={onChange} />);
    const area = screen.getByRole('textbox');
    (area as HTMLTextAreaElement).setSelectionRange(1, 1);
    fireEvent.keyDown(area, { key: 'Tab' });
    expect(onChange).toHaveBeenCalledWith('a  b');
  });
});
