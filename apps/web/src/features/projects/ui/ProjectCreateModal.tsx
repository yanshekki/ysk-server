import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Field, FormGrid, Modal } from '../../../shared/components/ui';
import { projectsApi } from '../api';

export interface ProjectCreateModalProps {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  onSubmit: (input: {
    name: string;
    domain?: string;
    domainAliases?: string[];
    runtime: 'node' | 'php' | 'static';
    templateId?: string;
    createDnsZone?: boolean;
    createMailDomain?: boolean;
    serverIp?: string;
  }) => Promise<void>;
}

export function ProjectCreateModal({ open, onClose, busy, onSubmit }: ProjectCreateModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [aliases, setAliases] = useState('');
  const [runtime, setRuntime] = useState<'node' | 'php' | 'static'>('node');
  const [templateId, setTemplateId] = useState('');
  const [createDns, setCreateDns] = useState(false);
  const [createMail, setCreateMail] = useState(false);
  const [serverIp, setServerIp] = useState('127.0.0.1');
  const [templates, setTemplates] = useState<
    Array<{ id: string; name: string; description: string; runtime: string }>
  >([]);

  useEffect(() => {
    if (!open) return;
    void projectsApi
      .listTemplates()
      .then((r) => setTemplates(r.items))
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setName('');
      setDomain('');
      setAliases('');
      setRuntime('node');
      setTemplateId('');
      setCreateDns(false);
      setCreateMail(false);
      setServerIp('127.0.0.1');
    }
  }, [open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const domainAliases = aliases
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    await onSubmit({
      name,
      domain: domain || undefined,
      domainAliases: domainAliases.length ? domainAliases : undefined,
      runtime,
      templateId: templateId || undefined,
      createDnsZone: Boolean(domain && createDns),
      createMailDomain: Boolean(domain && createMail),
      serverIp: createDns || createMail ? serverIp : undefined,
    });
  }

  const hasDomain = Boolean(domain.trim());

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('projects.create')}
      description={t('projects.createHint')}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose} loading={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            form="project-create-form"
            loading={busy}
            disabled={!name.trim()}
          >
            {t('projects.create')}
          </Button>
        </>
      }
    >
      <form id="project-create-form" onSubmit={(e) => void handleSubmit(e)}>
        <FormGrid>
          <Field label={t('projects.name')} htmlFor="pname" flush>
            <input
              id="pname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              placeholder="my-app"
            />
          </Field>
          <Field label={t('projects.domain')} htmlFor="pdomain" flush>
            <input
              id="pdomain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="app.example.com"
            />
          </Field>
          <Field label="別名（可選，逗號或換行）" htmlFor="paliases" flush>
            <input
              id="paliases"
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              placeholder="www.example.com"
            />
          </Field>
          <Field label={t('projects.runtime')} htmlFor="pruntime" flush>
            <select
              id="pruntime"
              value={runtime}
              onChange={(e) => setRuntime(e.target.value as 'node' | 'php' | 'static')}
            >
              <option value="node">Node.js</option>
              <option value="php">PHP</option>
              <option value="static">Static</option>
            </select>
          </Field>
          <Field label={t('projects.template')} htmlFor="ptpl" flush>
            <select
              id="ptpl"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                const tpl = templates.find((x) => x.id === e.target.value);
                if (tpl?.runtime === 'node' || tpl?.runtime === 'php' || tpl?.runtime === 'static') {
                  setRuntime(tpl.runtime);
                }
              }}
            >
              <option value="">{t('projects.templateNone')}</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </Field>
        </FormGrid>

        {hasDomain ? (
          <div className="u-mt-3 stack" style={{ gap: '0.5rem' }}>
            <label className="field field--check">
              <input
                type="checkbox"
                checked={createDns}
                onChange={(e) => setCreateDns(e.target.checked)}
              />
              <span>同時建立 DNS zone（管理檔 draft）</span>
            </label>
            <label className="field field--check">
              <input
                type="checkbox"
                checked={createMail}
                onChange={(e) => setCreateMail(e.target.checked)}
              />
              <span>同時登記郵件域名</span>
            </label>
            {createDns || createMail ? (
              <Field label="伺服器 IP（DNS / 郵件）" htmlFor="pserverip" flush>
                <input
                  id="pserverip"
                  value={serverIp}
                  onChange={(e) => setServerIp(e.target.value)}
                  placeholder="203.0.113.10"
                />
              </Field>
            ) : null}
          </div>
        ) : null}

        {templateId ? (
          <p className="muted u-text-sm u-mt-3">
            {templates.find((x) => x.id === templateId)?.description}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
