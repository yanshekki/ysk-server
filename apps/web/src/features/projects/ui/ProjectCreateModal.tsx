import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionBar,
  Button,
  CheckboxField,
  Field,
  FormHint,
  FormLayout,
  Modal,
  SegRadio } from '../../../shared/components/ui';
import { projectsApi } from '../api';
import { formatRuntimeName } from '../model/runtime-ui';
import { bindInput } from '../../../pages/bind-handlers';
import {
  defaultRuntimeInstallVersion,
  fetchRuntimeVersionChoices,
  runtimeVersionChoices } from '../model/deploy-prefs';

type ProjectRuntime =
  | 'node'
  | 'php'
  | 'static'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'kotlin'
  | 'bun';

const PROJECT_RUNTIMES: ProjectRuntime[] = [
  'node',
  'php',
  'static',
  'python',
  'go',
  'rust',
  'java',
  'kotlin',
  'bun',
];

function asProjectRuntime(v: string | undefined | null): ProjectRuntime | null {
  if (!v) return null;
  const x = v.trim().toLowerCase();
  return PROJECT_RUNTIMES.includes(x as ProjectRuntime) ? (x as ProjectRuntime) : null;
}

type AppTemplateItem = {
  id: string;
  name: string;
  description: string;
  runtime: string;
};

/** Client fallback when GET /templates fails or is empty — one Hello World per runtime. */
const HELLO_TEMPLATES: AppTemplateItem[] = PROJECT_RUNTIMES.map((rt) => ({
  id: `${rt}-hello`,
  name: 'Hello World!',
  description: `Minimal ${rt} demo`,
  runtime: rt }));

function helloTemplateId(runtime: ProjectRuntime): string {
  return `${runtime}-hello`;
}

export interface ProjectCreateModalProps {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  /** Prefill from software hub ?hintRuntime= */
  initialRuntime?: string | null;
  initialRuntimeVersion?: string | null;
  onSubmit: (input: {
    name: string;
    domain?: string;
    domainAliases?: string[];
    runtime: ProjectRuntime;
    runtimeVersion?: string;
    templateId?: string;
    gitUrl?: string;
    gitBranch?: string;
    goLive?: boolean;
    preferredPort?: number;
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
  initialRuntime,
  initialRuntimeVersion,
  onSubmit }: ProjectCreateModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [aliases, setAliases] = useState('');
  const [runtime, setRuntime] = useState<ProjectRuntime>('node');
  const [runtimeVersion, setRuntimeVersion] = useState(() =>
    defaultRuntimeInstallVersion('node'),
  );
  const [templateId, setTemplateId] = useState(() => helloTemplateId('node'));
  const [gitUrl, setGitUrl] = useState('');
  const [gitBranch, setGitBranch] = useState('');
  const [goLive, setGoLive] = useState(true);
  const [preferredPort, setPreferredPort] = useState('');
  const [createDns, setCreateDns] = useState(false);
  const [createMail, setCreateMail] = useState(false);
  const [serverIp, setServerIp] = useState('');
  const [serverIpv6, setServerIpv6] = useState('');
  const [templates, setTemplates] = useState<AppTemplateItem[]>(HELLO_TEMPLATES);

  const [versionChoices, setVersionChoices] = useState<string[]>(() =>
    runtimeVersionChoices('node'),
  );
  const [versionsLoading, setVersionsLoading] = useState(false);
  const versionReq = useRef(0);

  useEffect(() => {
    if (!open) return;
    void projectsApi
      .listTemplates()
      .then((r) => {
        const items = Array.isArray(r.items) ? r.items : [];
        // Merge API + fallback so every runtime always has a Hello World option
        const byRuntime = new Map<string, AppTemplateItem>();
        for (const h of HELLO_TEMPLATES) byRuntime.set(h.runtime, h);
        for (const it of items) {
          if (it?.runtime && it?.id) {
            byRuntime.set(String(it.runtime), {
              id: String(it.id),
              name: String(it.name || 'Hello World!'),
              description: String(it.description || ''),
              runtime: String(it.runtime) });
          }
        }
        setTemplates([...byRuntime.values()]);
      })
      .catch(() => setTemplates(HELLO_TEMPLATES));
  }, [open]);

  // Seed offline fallback immediately; discovery replaces when it returns.
  useEffect(() => {
    if (!open) return;
    const seq = ++versionReq.current;
    const fallback = runtimeVersionChoices(runtime);
    if (fallback.length) setVersionChoices(fallback);
    setVersionsLoading(true);
    void fetchRuntimeVersionChoices(runtime).then((r) => {
      if (seq !== versionReq.current) return;
      const choices = r.choices.length ? r.choices : fallback;
      setVersionChoices(choices);
      setRuntimeVersion((prev) =>
        choices.includes(prev) ? prev : r.latest || choices[0] || prev,
      );
      setVersionsLoading(false);
    });
  }, [open, runtime]);

  useEffect(() => {
    if (!open) {
      setName('');
      setDomain('');
      setAliases('');
      setRuntime('node');
      setRuntimeVersion(defaultRuntimeInstallVersion('node'));
      setVersionChoices([]);
      setVersionsLoading(false);
      setTemplateId(helloTemplateId('node'));
      setGitUrl('');
      setGitBranch('');
      setGoLive(true);
      setPreferredPort('');
      setCreateDns(false);
      setCreateMail(false);
      setServerIp('');
      setServerIpv6('');
      return;
    }
    // Prefill when opened from software hub
    const rt = asProjectRuntime(initialRuntime);
    if (rt) {
      setRuntime(rt);
      void fetchRuntimeVersionChoices(rt).then((r) => {
        const choices = r.choices.length ? r.choices : runtimeVersionChoices(rt);
        setVersionChoices(choices);
        const want = (initialRuntimeVersion ?? '').trim();
        if (want && (choices.includes(want) || choices.some((c) => want.startsWith(`${c}.`)))) {
          const match = choices.find((c) => c === want || want.startsWith(`${c}.`)) ?? want;
          setRuntimeVersion(choices.includes(match) ? match : choices[0] ?? want);
        } else {
          setRuntimeVersion(r.latest || choices[0] || defaultRuntimeInstallVersion(rt));
        }
      });
    }
  }, [open, initialRuntime, initialRuntimeVersion]);

  function applyRuntime(next: ProjectRuntime) {
    setRuntime(next);
    const fallback = runtimeVersionChoices(next);
    if (fallback.length) setVersionChoices(fallback);
    setRuntimeVersion(defaultRuntimeInstallVersion(next) || fallback[0] || '');
    if (gitUrl.trim()) {
      setTemplateId('');
      return;
    }
    // Always offer / preselect Hello World for the chosen runtime (incl. PHP)
    const match =
      templates.find((x) => x.runtime === next) ||
      HELLO_TEMPLATES.find((x) => x.runtime === next);
    setTemplateId(match?.id ?? helloTemplateId(next));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (/[\\/]/.test(name)) return;
    const domainAliases = aliases
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const portNum = preferredPort.trim() ? Number(preferredPort.trim()) : undefined;
    const fromGit = Boolean(gitUrl.trim());
    await onSubmit({
      name,
      domain: domain || undefined,
      domainAliases: domainAliases.length ? domainAliases : undefined,
      runtime,
      runtimeVersion:
        runtime !== 'static' && runtimeVersion
          ? runtimeVersion
          : undefined,
      templateId: fromGit ? undefined : templateId || undefined,
      gitUrl: fromGit ? gitUrl.trim() : undefined,
      gitBranch: fromGit ? gitBranch.trim() || undefined : undefined,
      // Git create stores the remote only — clone + deploy from the App tab
      goLive: fromGit ? false : templateId ? goLive !== false : goLive,
      preferredPort:
        portNum != null && Number.isFinite(portNum) && portNum > 0 && portNum < 65536
          ? Math.floor(portNum)
          : undefined,
      createDnsZone: Boolean(domain && createDns),
      createMailDomain: Boolean(domain && createMail),
      serverIp: createDns || createMail ? serverIp : undefined,
      serverIpv6:
        createDns || createMail
          ? serverIpv6.trim() || undefined
          : undefined });
  }

  const hasDomain = Boolean(domain.trim());

  /** Only templates for the selected runtime (PHP → php-hello, etc.). */
  const filteredTemplates = useMemo(() => {
    const forRt = templates.filter((t) => t.runtime === runtime);
    if (forRt.length > 0) return forRt;
    const fb = HELLO_TEMPLATES.find((t) => t.runtime === runtime);
    return fb ? [fb] : [];
  }, [templates, runtime]);

  // Keep templateId in sync when runtime/templates change ('' = none is valid)
  useEffect(() => {
    if (!open) return;
    if (templateId === '') return;
    const stillValid = filteredTemplates.some((t) => t.id === templateId);
    if (!stillValid) {
      setTemplateId(gitUrl.trim() ? '' : filteredTemplates[0]?.id ?? helloTemplateId(runtime));
    }
  }, [open, runtime, filteredTemplates, templateId, gitUrl]);

  const selectedTpl =
    filteredTemplates.find((x) => x.id === templateId) ||
    templates.find((x) => x.id === templateId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('projects.create')}
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
            disabled={!name.trim() || /[\\/]/.test(name)}
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
          <Field
            label={t('projects.createName')}
            htmlFor="pname"
            required
            flush
            error={/[\\/]/.test(name) ? t('projects.noPathSepHint') : undefined}
          >
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
                { value: 'java', label: 'Java' },
                { value: 'kotlin', label: 'Kotlin' },
                { value: 'bun', label: 'Bun' },
                { value: 'static', label: t('common.static') },
              ]}
            />
          </Field>
          {versionsLoading && versionChoices.length === 0 ? (
            <p className="muted u-text-sm">{t('common.loading')}</p>
          ) : null}
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
                        : v }))}
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
                  tpl?.runtime === 'rust' ||
                  tpl?.runtime === 'java' ||
                  tpl?.runtime === 'kotlin' ||
                  tpl?.runtime === 'bun'
                ) {
                  applyRuntime(tpl.runtime);
                }
              }}
            >
              <option value="">{t('projects.templateNone')}</option>
              {filteredTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name || 'Hello World!'}
                  {tpl.id ? ` · ${tpl.id}` : ''}
                </option>
              ))}
            </select>
          </Field>
          {filteredTemplates.length === 0 ? (
            <FormHint>
              {t('projects.createTemplateMissing', {
                runtime: formatRuntimeName(runtime, t) })}
            </FormHint>
          ) : null}
          <Field
            label={t('projects.gitUrl')}
            htmlFor="pgit"
            hint={t('projects.createGitHint')}
            flush
          >
            <input
              id="pgit"
              value={gitUrl}
              onChange={(e) => {
                const v = e.target.value;
                setGitUrl(v);
                if (v.trim()) {
                  setTemplateId('');
                  setGoLive(false);
                } else if (templateId === '') {
                  setTemplateId(helloTemplateId(runtime));
                  setGoLive(true);
                }
              }}
              placeholder="https://github.com/org/repo.git"
            />
          </Field>
          {gitUrl.trim() ? (
            <Field
              label={t('projects.gitBranch')}
              htmlFor="pbranch"
              hint={t('projects.gitBranchHint')}
              flush
            >
              <input
                id="pbranch"
                value={gitBranch}
                onChange={bindInput(setGitBranch)}
                placeholder="main"
              />
            </Field>
          ) : null}
        </FormLayout>

        <FormLayout>
          <CheckboxField
            id="pc-golive"
            label={t('projects.createGoLive', { })}
            checked={gitUrl.trim() ? false : goLive}
            onChange={setGoLive}
            disabled={busy || Boolean(gitUrl.trim())}
          />
          {runtime !== 'static' && runtime !== 'php' ? (
            <Field
              label={t('projects.createPreferredPort')}
              htmlFor="pport"
              flush
            >
              <input
                id="pport"
                inputMode="numeric"
                value={preferredPort}
                onChange={bindInput(setPreferredPort)}
                placeholder="auto"
                disabled={busy}
              />
            </Field>
          ) : null}
        </FormLayout>

        {/* ④ 草稿資源 */}
        <div className="project-create-form__extras">
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
