/**
 * Security allowlist + host probe + operator 2FA.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSecurity } from '../features/security';
import { api } from '../shared/services/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  EmptyState,
  FeaturePageLayout,
  Field,
  SummaryStrip,
} from '../shared/components/ui';

export function SecurityPage() {
  const { t } = useTranslation();
  const { tools, approvals, error, result, busy, runSysInfo, approve } = useSecurity();
  const [totpStatus, setTotpStatus] = useState<{ enabled: boolean; enrolled: boolean } | null>(
    null,
  );
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpUrl, setTotpUrl] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpMsg, setTotpMsg] = useState<string | null>(null);
  const [totpErr, setTotpErr] = useState<string | null>(null);
  const [totpBusy, setTotpBusy] = useState(false);

  const refreshTotp = useCallback(async () => {
    setTotpStatus(await api.totpStatus());
  }, []);

  useEffect(() => {
    void refreshTotp().catch(() => undefined);
  }, [refreshTotp]);

  const allowed = tools.filter((tool) => tool.allowed).length;
  const needsApproval = tools.filter((tool) => tool.requiresApproval).length;

  const probeItems = (() => {
    if (!result) return [];
    try {
      const o = JSON.parse(result) as Record<string, unknown>;
      return Object.entries(o)
        .filter(([, v]) => v == null || typeof v !== 'object')
        .slice(0, 16)
        .map(([k, v]) => ({ label: k, value: String(v) }));
    } catch {
      return [{ label: 'Output', value: result.slice(0, 500) }];
    }
  })();

  return (
    <FeaturePageLayout
      title={t('security.title')}
      subtitle={t('security.allowlist')}
      showCapability={false}
      actions={
        <Button variant="primary" size="md" loading={busy} onClick={() => void runSysInfo()}>
          {t('security.runSysInfo')}
        </Button>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {totpErr ? <Alert variant="error">{totpErr}</Alert> : null}
      {totpMsg ? <Alert variant="ok">{totpMsg}</Alert> : null}
      <Alert variant="info">{t('security.llmUntrusted')}</Alert>

      <SummaryStrip
        items={[
          { label: '工具', value: tools.length },
          { label: '允許', value: allowed, tone: 'ok' },
          { label: '需批准', value: needsApproval, tone: 'warn' },
          {
            label: '待批',
            value: approvals.length,
            tone: approvals.length > 0 ? 'danger' : 'default',
          },
          {
            label: '2FA',
            value: totpStatus?.enabled ? '已啟用' : '未啟用',
            tone: totpStatus?.enabled ? 'ok' : 'warn',
          },
        ]}
      />

      <div className="stack">
        <Card>
          <CardSection title="操作員雙重驗證 (TOTP)">
            <p className="muted u-text-sm">
              狀態：{totpStatus?.enabled ? '已啟用' : totpStatus?.enrolled ? '已產生密鑰、未確認' : '未設定'}
            </p>
            <div className="btn-row u-mt-2">
              <Button
                variant="primary"
                size="md"
                loading={totpBusy}
                onClick={() => {
                  setTotpBusy(true);
                  setTotpErr(null);
                  void api
                    .totpBegin()
                    .then((r) => {
                      setTotpSecret(r.secret);
                      setTotpUrl(r.otpauthUrl);
                      setTotpMsg('已產生密鑰 — 用驗證器 App 掃描後輸入 6 位碼確認');
                      return refreshTotp();
                    })
                    .catch((e: Error) => setTotpErr(e.message))
                    .finally(() => setTotpBusy(false));
                }}
              >
                {totpStatus?.enabled ? '重新設定 2FA' : '開始設定 2FA'}
              </Button>
            </div>
            {totpSecret ? (
              <div className="u-mt-3">
                <p className="muted u-text-sm">
                  Secret：<code className="inline">{totpSecret}</code>
                </p>
                {totpUrl ? (
                  <p className="muted u-text-sm u-break-all">
                    <code className="inline">{totpUrl}</code>
                  </p>
                ) : null}
                <Field label="確認碼" htmlFor="totp-confirm">
                  <input
                    id="totp-confirm"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    maxLength={6}
                    placeholder="6 位"
                  />
                </Field>
                <div className="btn-row u-mt-2">
                  <Button
                    variant="primary"
                    size="md"
                    loading={totpBusy}
                    onClick={() => {
                      setTotpBusy(true);
                      setTotpErr(null);
                      void api
                        .totpConfirm(totpCode)
                        .then(() => {
                          setTotpMsg('2FA 已啟用');
                          setTotpSecret(null);
                          setTotpCode('');
                          return refreshTotp();
                        })
                        .catch((e: Error) => setTotpErr(e.message))
                        .finally(() => setTotpBusy(false));
                    }}
                  >
                    確認啟用
                  </Button>
                  {totpStatus?.enabled ? (
                    <Button
                      variant="danger"
                      size="md"
                      loading={totpBusy}
                      onClick={() => {
                        setTotpBusy(true);
                        setTotpErr(null);
                        void api
                          .totpDisable(totpCode)
                          .then(() => {
                            setTotpMsg('2FA 已關閉');
                            setTotpSecret(null);
                            setTotpCode('');
                            return refreshTotp();
                          })
                          .catch((e: Error) => setTotpErr(e.message))
                          .finally(() => setTotpBusy(false));
                      }}
                    >
                      關閉 2FA
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </CardSection>
        </Card>

        <Card>
          <CardSection title="主機探測" description="讀取主機資訊（allowlist 工具）">
            {probeItems.length > 0 ? (
              <DescriptionList columns={2} items={probeItems} />
            ) : (
              <p className="muted">尚未執行 — 按右上角「{t('security.runSysInfo')}」</p>
            )}
          </CardSection>
        </Card>

        <Card>
          <CardSection title={t('security.pending')}>
            {approvals.length === 0 ? (
              <EmptyState title={t('security.none')} />
            ) : (
              <div className="list-panel">
                {approvals.map((a) => (
                  <div key={String(a.id)} className="list-row list-row--static">
                    <div className="list-row__main">
                      <div className="list-row__title">
                        <code className="inline">{String(a.action)}</code>
                        <Badge tone="warn">{String(a.risk)}</Badge>
                      </div>
                      <div className="list-row__meta">
                        <span>{String(a.requestedBy ?? a.requested_by ?? '—')}</span>
                      </div>
                    </div>
                    <div className="list-row__side">
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        onClick={() => void approve(String(a.id))}
                      >
                        批准
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardSection>
        </Card>

        <Card>
          <CardSection title={`Allowlist (${tools.length})`}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Allowed</th>
                    <th>Risk</th>
                    <th>Approval</th>
                  </tr>
                </thead>
                <tbody>
                  {tools.map((tool) => (
                    <tr key={String(tool.tool)}>
                      <td>
                        <code className="inline">{String(tool.tool)}</code>
                      </td>
                      <td>
                        <Badge tone={tool.allowed ? 'ok' : 'danger'}>
                          {String(tool.allowed)}
                        </Badge>
                      </td>
                      <td>{String(tool.risk)}</td>
                      <td>{String(tool.requiresApproval)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardSection>
        </Card>
      </div>
    </FeaturePageLayout>
  );
}
