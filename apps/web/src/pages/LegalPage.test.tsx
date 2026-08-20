import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LegalPage } from './LegalPage';
import { LoginPage } from './LoginPage';

function renderLegal(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/legal" element={<LegalPage />} />
        <Route path="/legal/:docId" element={<LegalPage />} />
        <Route path="/login" element={<div>login-body</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LegalPage', () => {
  it('renders the public hub without a sign-in form', () => {
    renderLegal('/legal');
    expect(screen.getByRole('heading', { name: /^legal$/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /terms of use/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /privacy policy/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /disclaimer/i }).length).toBeGreaterThan(0);
    expect(screen.getByText(/english version controls/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    expect(document.querySelector('[data-legal-doc="index"]')).toBeTruthy();
  });

  it('shows Terms, Privacy, and Disclaimer articles', () => {
    const { unmount } = renderLegal('/legal/terms');
    expect(screen.getByRole('heading', { name: /terms of use/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /1\. agreement/i })).toBeInTheDocument();
    expect(screen.getByText(/YSK_EXECUTE=1/)).toBeInTheDocument();
    expect(screen.getByText(/non-custodial/i)).toBeInTheDocument();
    unmount();

    renderLegal('/legal/privacy');
    expect(screen.getByRole('heading', { name: /privacy policy/i })).toBeInTheDocument();
    expect(screen.getByText(/does not receive telemetry/i)).toBeInTheDocument();
  });

  it('loads the disclaimer with AS IS and Hong Kong law', () => {
    renderLegal('/legal/disclaimer');
    expect(screen.getByRole('heading', { name: /^disclaimer$/i })).toBeInTheDocument();
    expect(screen.getAllByText(/AS IS/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Cap\. 71/)).toBeInTheDocument();
  });

  it('switches official body language to Hong Kong Chinese', async () => {
    const user = userEvent.setup();
    renderLegal('/legal/terms');
    await user.click(screen.getByRole('button', { name: /繁體中文（香港）/ }));
    expect(await screen.findByRole('heading', { name: /使用條款/ })).toBeInTheDocument();
    expect(screen.getByText(/以英文為準/)).toBeInTheDocument();
    expect(document.querySelector('[data-legal-lang="zh-HK"]')).toBeTruthy();
  });

  it('redirects unknown legal paths to the hub', () => {
    renderLegal('/legal/not-a-doc');
    expect(screen.getByRole('heading', { name: /^legal$/i })).toBeInTheDocument();
    expect(document.querySelector('[data-legal-doc="index"]')).toBeTruthy();
  });
});

describe('LoginPage legal footer', () => {
  it('links Terms, Privacy, and Disclaimer', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/legal/:docId" element={<div>legal-body</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /terms of use/i })).toHaveAttribute(
      'href',
      '/legal/terms',
    );
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute(
      'href',
      '/legal/privacy',
    );
    expect(screen.getByRole('link', { name: /disclaimer/i })).toHaveAttribute(
      'href',
      '/legal/disclaimer',
    );
  });
});
