import { useTranslation } from 'react-i18next';

export function SecurityPage() {
  const { t } = useTranslation();
  return (
    <div className="card">
      <h1>{t('security.title')}</h1>
      <p>{t('security.allowlist')}</p>
      <p>{t('security.llmUntrusted')}</p>
      <ul>
        <li>Allowlist (code-level, fail-closed)</li>
        <li>Human Approval for high-risk actions</li>
        <li>RBAC: role × scope × operation level</li>
        <li>Kernel Sandbox plans for constrained execution</li>
      </ul>
    </div>
  );
}
