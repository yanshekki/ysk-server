import { useTranslation } from 'react-i18next';

const RUNTIMES = [
  { name: 'OpenClaw', kind: 'openclaw' },
  { name: 'Hermes', kind: 'hermes' },
  { name: 'IonClaw', kind: 'ionclaw' },
];

export function AgentsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <header className="page-header">
        <h1>{t('agents.title')}</h1>
        <p>{t('agents.body')}</p>
      </header>
      <div className="grid">
        {RUNTIMES.map((r) => (
          <div className="card" key={r.kind}>
            <h2 className="card__title">{r.name}</h2>
            <p className="card__desc">
              <code className="inline">{r.kind}</code>
            </p>
            <span className="badge badge--warn">managed</span>
          </div>
        ))}
      </div>
    </div>
  );
}
