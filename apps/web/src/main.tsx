import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { ErrorBoundary } from './shared/components/ErrorBoundary';
import { bootstrapI18n } from './shared/lib/i18n';
import './styles/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root');

function hideBootSplash(): void {
  document.getElementById('ysk-boot')?.remove();
}

void bootstrapI18n()
  .then(() => {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    );
    hideBootSplash();
  })
  .catch((err) => {
    console.error('[ysk] bootstrap failed', err);
    hideBootSplash();
    const msg = String(err?.message || err)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    rootEl.innerHTML =
      '<div style="font:14px/1.5 system-ui;padding:2rem;max-width:36rem;margin:auto">' +
      '<h1 style="font-size:1.25rem">YSK Server failed to start</h1>' +
      '<p>Check the browser console / network tab, then hard-refresh (Ctrl+Shift+R).</p>' +
      '<pre style="white-space:pre-wrap;background:#111;color:#eee;padding:1rem;border-radius:8px">' +
      msg +
      '</pre></div>';
  });
