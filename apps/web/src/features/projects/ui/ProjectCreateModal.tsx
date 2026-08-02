import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionBar,
  Badge,
  Button,
  CheckboxField,
  Field,
  FormHint,
  FormLayout,
  Modal,
  SegRadio,
} from '../../../shared/components/ui';
import { projectsApi } from '../api';
import { formatRuntimeName } from '../model/runtime-ui';
import { bindInput } from '../../../pages/bind-handlers';
import {
  defaultRuntimeInstallVersion,
  runtimeVersionChoices,
} from '../model/deploy-prefs';

export interface ProjectCreateModalProps {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  onSubmit: (input: {
    name: string;
    domain?: string;
    domainAliases?: string[];
    runtime: 'node' | 'php' | 'static' | 'python' | 'go' | 'rust';
    runtimeVersion?: string;
    templateId?: string;
    createDnsZone?: boolean;
    createMailDomain?: boolean;
    serverIp?: string;
    serverIpv6?: string;
  }) => Promise<void>;
}

export function ProjectCreateModal({
  open,
  onClose,
  busy,
  onSubmit,
}: ProjectCreateModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [aliases, setAliases] = useState('');
  const [runtime, setRuntime] = useState<
    'node' | 'php' | 'static' | 'python' | 'go' | 'rust'
  >('node');
  const [runtimeVersion, setRuntimeVersion] = useState(() =>
    defaultRuntimeInstallVersion('node'),
  );
  const [templateId, setTemplateId] = useState('');
  const [createDns, setCreateDns] = useState(false);
  const [createMail, setCreateMail] = useState(false);
  const [serverIp, setServerIp] = useState('');
  const [serverIpv6, setServerIpv6] = useState('');
  const [templates, setTemplates] = useState<
    Array<{ id: string; name: string; description: string; runtime: string }>
  >([]);

  const versionChoices = useMemo(
    () => runtimeVersionChoices(runtime),
    [runtime],
  );

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
      setRuntimeVersion(defaultRuntimeInstallVersion('node'));
      setTemplateId('');
      setCreateDns(false);
      setCreateMail(false);
      setServerIp('');
      setServerIpv6('');
    }
  }, [open]);

  function applyRuntime(next: typeof runtime) {
    setRuntime(next);
    const choices = runtimeVersionChoices(next);
    const def = defaultRuntimeInstallVersion(next);
    setRuntimeVersion(choices.includes(def) ? def : choices[0] ?? '');
    const tpl = templates.find((x) => x.id === templateId);
    if (tpl && tpl.runtime !== next) setTemplateId('');
  }

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
      runtimeVersion:
        runtime !== 'static' && runtimeVersion
          ? runtimeVersion
          : undefined,
      templateId: templateId || undefined,
      createDnsZone: Boolean(domain && createDns),
      createMailDomain: Boolean(domain && createMail),
      serverIp: createDns || createMail ? serverIp : undefined,
      serverIpv6:
        createDns || createMail
          ? serverIpv6.trim() || undefined
          : undefined,
    });
  }

  const hasDomain = Boolean(domain.trim());

  const filteredTemplates = useMemo(() => {
    return [...templates].sort((a, b) => {
      const aMatch = a.runtime === runtime ? 0 : 1;
      const bMatch = b.runtime === runtime ? 0 : 1;
      return aMatch - bMatch;
    });
  }, [templates, runtime]);

  const selectedTpl = templates.find((x) => x.id === templateId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('projects.create')}
      description={t('projects.createHint')}
      size="lg"
      footer={
        <ActionBar size="md" align="end">
          <Button
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={busy}
          >
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
        </ActionBar>
      }
    >
      <form
        id="project-create-form"
        className="project-create-form"
        onSubmit={(e) => void handleSubmit(e)}
      >
        {/* ① 基本：單欄，避免 SegRadio 把兩欄撐歪 */}
        <FormLayout>
          <Field label={t('projects.createName')} htmlFor="pname" required flush>
            <input
              id="pname"
              value={name}
              onChange={bindInput(setName)}
              required
              autoFocus
              placeholder="my-app"
            />
          </Field>
          <Field
            label={t('readiness.cat.hosting')}
            htmlFor="pruntime"
            hint={t('projects.createRuntimeHint')}
            flush
          >
            <SegRadio
              name="pruntime"
              aria-label={t('readiness.cat.hosting')}
              value={runtime}
              onChange={(next) => applyRuntime(next as typeof runtime)}
              options={[
                { value: 'node', label: 'Node' },
                { value: 'php', label: 'PHP' },
                { value: 'python', label: 'Python' },
                { value: 'go', label: 'Go' },
                { value: 'rust', label: 'Rust' },
                { value: 'static', label: t('common.static') },
              ]}
            />
          </Field>
          {versionChoices.length > 0 ? (
            <Field
              label={t('common.version')}
              htmlFor="pver"
              flush
              required
              hint={t('projects.createVersionHint')}
            >
              <SegRadio
                name="pver"
                aria-label={t('projects.createVersionAria')}
                value={
                  versionChoices.includes(runtimeVersion)
                    ? runtimeVersion
                    : versionChoices[0]!
                }
                onChange={setRuntimeVersion}
                options={versionChoices.map((v) => ({
                  value: v,
                  label:
                    runtime === 'node' && v === '20'
                      ? '20 LTS'
                      : runtime === 'rust' && v === 'stable'
                        ? 'stable'
                        : v,
                }))}
              />
            </Field>
          ) : null}
        </FormLayout>

        {/* ② 域名：兩欄對齊 */}
        <FormLayout columns={2}>
          <Field label={t('projects.netPrimaryDomain')} htmlFor="pdomain" hint={t('projects.createPrimaryDomainHint')} flush>
            <input
              id="pdomain"
              value={domain}
              onChange={bindInput(setDomain)}
              placeholder="app.example.com"
            />
          </Field>
          <Field label={t('projects.ovAliases')} htmlFor="paliases" hint={t('projects.createAliasesHint')} flush>
            <input
              id="paliases"
              value={aliases}
              onChange={bindInput(setAliases)}
              placeholder="www.example.com"
            />
          </Field>
        </FormLayout>

        {/* ③ 範本 */}
        <FormLayout>
          <Field
            label={t('projects.createTemplate')}
            htmlFor="ptpl"
            flush
            hint={t('projects.createTemplateHint')}
          >
            <select
              id="ptpl"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                const tpl = templates.find((x) => x.id === e.target.value);
                if (
                  tpl?.runtime === 'node' ||
                  tpl?.runtime === 'php' ||
                  tpl?.runtime === 'static' ||
                  tpl?.runtime === 'python' ||
                  tpl?.runtime === 'go' ||
                  tpl?.runtime === 'rust'
                ) {
                  applyRuntime(tpl.runtime);
                }
              }}
            >
              <option value="">{t('projects.templateNone')}</option>
              {filteredTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                  {tpl.runtime === runtime
                    ? ''
                    : `（${formatRuntimeName(tpl.runtime, t)}）`}
                </option>
              ))}
            </select>
          </Field>
        </FormLayout>

        {selectedTpl ? (
          <div className="project-create-form__tpl">
            <ActionBar size="sm" className="u-mb-2">
              <strong>{selectedTpl.name}</strong>
              <Badge tone="info">
                {formatRuntimeName(selectedTpl.runtime, t)}
              </Badge>
            </ActionBar>
            <p className="muted u-text-sm u-mb-0">{selectedTpl.description}</p>
            <p className="muted u-text-sm u-mt-2 u-mb-0">
              {t('projects.createTemplateNote')}
            </p>
          </div>
        ) : (
          <FormHint>
            {t('projects.createRuntimeNow')}
            <strong>{formatRuntimeName(runtime, t)}</strong>
            {t('projects.createTemplateFooter')}
          </FormHint>
        )}

        {/* ④ 草稿資源 — 永遠顯示（唔再因未填域名而消失） */}
        <div className="project-create-form__extras">
          <p className="project-create-form__extras-title">
            {t('projects.createDraftResources')}
          </p>
          {!hasDomain ? (
            <FormHint>
              {t('projects.createNeedDomainFirst')}
            </FormHint>
          ) : null}
          <div className="form-switches">
            <CheckboxField
              id="pc-dns"
              label={t('projects.createDnsZone')}
              description={t('projects.createDnsZoneDesc')}
              checked={createDns && hasDomain}
              onChange={(v) => setCreateDns(v)}
              disabled={!hasDomain || busy}
            />
            <CheckboxField
              id="pc-mail"
              label={t('projects.createMailDomain')}
              description={t('projects.createMailDomainDesc')}
              checked={createMail && hasDomain}
              onChange={(v) => setCreateMail(v)}
              disabled={!hasDomain || busy}
            />
          </div>
          {hasDomain && (createDns || createMail) ? (
            <FormLayout columns={2}>
              <Field
                label={t('projects.createServerIpv4')}
                htmlFor="pc-ip"
                flush
                hint={t('projects.createServerIpv4Hint')}
              >
                <input
                  id="pc-ip"
                  value={serverIp}
                  onChange={bindInput(setServerIp)}
                  placeholder={t('projects.createServerIpv4Ph')}
                />
              </Field>
              <Field label={t('projects.createServerIpv6')} htmlFor="pc-ip6" flush>
                <input
                  id="pc-ip6"
                  value={serverIpv6}
                  onChange={bindInput(setServerIpv6)}
                  placeholder={t('projects.createServerIpv6Ph')}
                />
              </Field>
            </FormLayout>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
