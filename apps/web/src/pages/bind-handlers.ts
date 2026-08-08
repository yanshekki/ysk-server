/**
 * Shared bind helpers — collapse per-call-site JSX arrows into one
 * instrumented function that unit tests can cover fully.
 */

// Permissive aliases so React Dispatch / withBusy / ops runners type-check
// without fighting contravariance on Promise<void> vs Promise<unknown>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BusyRunner = (fn: () => Promise<any>, msg?: string) => any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WithBusy = (fn: () => Promise<any>) => any;

/** Fire-and-forget async action (project run, preset apply, ban, …). */
export function bindAsync(fn: () => void | Promise<unknown>): () => void {
  return () => {
    void Promise.resolve(fn()).catch(() => undefined);
  };
}

/** setState(true/false) toggle binder. */
export function bindSet<T>(set: AnyFn, value: T): () => void {
  return () => {
    set(value);
  };
}

/** Two setState calls without a call-site arrow. */
export function bindSet2<A, B>(
  setA: (v: A) => void,
  a: A,
  setB: (v: B) => void,
  b: B,
): () => void {
  return () => {
    setA(a);
    setB(b);
  };
}

/** Three setState calls. */
export function bindSet3<A, B, C>(
  setA: (v: A) => void,
  a: A,
  setB: (v: B) => void,
  b: B,
  setC: (v: C) => void,
  c: C,
): () => void {
  return () => {
    setA(a);
    setB(b);
    setC(c);
  };
}

/** Functional toggle binder: set(v => !v). */
export function bindToggle(set: (updater: (v: boolean) => boolean) => void): () => void {
  return () => {
    set((v) => !v);
  };
}

/** Bind setState from input change event. */
export function bindInput(
  set: AnyFn,
): (e: { target: { value: string } }) => void {
  return (e) => {
    set(e.target.value);
  };
}

/** Bind setState from checkbox. */
export function bindCheck(
  set: AnyFn,
): (e: { target: { checked: boolean } }) => void {
  return (e) => {
    set(e.target.checked);
  };
}

/** Bind number parse into setState. */
export function bindNumber(
  set: AnyFn,
  fallback = 0,
): (e: { target: { value: string } }) => void {
  return (e) => {
    const n = Number(e.target.value);
    set(Number.isFinite(n) ? n : fallback);
  };
}

/** Call with a fixed first arg (row action). */
export function bindArg1<A, R>(fn: (a: A) => R, a: A): () => R {
  return () => fn(a);
}

/** Call with two fixed args. */
export function bindArg2<A, B, R>(fn: (a: A, b: B) => R, a: A, b: B): () => R {
  return () => fn(a, b);
}

/** Ignore event and call fn (for onClick that shouldn't receive the event). */
export function bindIgnoreEvent(fn: () => void): (e?: unknown) => void {
  return () => {
    fn();
  };
}

/** Prevent default then call. */
export function bindPrevent(
  fn: () => void,
): (e: { preventDefault(): void }) => void {
  return (e) => {
    e.preventDefault();
    fn();
  };
}

/** Dialog onConfirm that closes after. */
export function bindConfirm(
  action: () => void | Promise<unknown>,
  close: AnyFn,
): () => void {
  return () => {
    void Promise.resolve(action()).finally(close);
  };
}

/** Multi-action sequence binder. */
export function bindSeq(...fns: Array<() => void>): () => void {
  return () => {
    for (const f of fns) f();
  };
}

/** Set string field on a draft object via key. */
export function bindDraftField<K extends string>(
  setDraft: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
  key: K,
): (e: { target: { value: string } }) => void {
  return (e) => {
    const v = e.target.value;
    setDraft((prev) => ({ ...prev, [key]: v }));
  };
}

/** Toggle id in a Record<string, boolean> selection map. */
export function bindToggleKey(
  setSelected: (
    updater: (prev: Record<string, boolean>) => Record<string, boolean>,
  ) => void,
  key: string,
): () => void {
  return () => {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  };
}

/** Toggle membership in a string[] state. */
export function bindToggleInList<T extends string>(
  setList: (updater: (prev: T[]) => T[]) => void,
  item: T,
): () => void {
  return () => {
    setList((prev) =>
      prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item],
    );
  };
}

/** Navigate binder for react-router navigate. */
export function bindNavigate(
  navigate: AnyFn,
  to: string,
): () => void {
  return () => {
    navigate(to);
  };
}

/** JSON-safe no-op for optional callbacks. */
export function noop(): void {
  /* intentionally empty */
}

/** Always-true predicate helper. */
export function alwaysTrue(): boolean {
  return true;
}

/** Always-false predicate helper. */
export function alwaysFalse(): boolean {
  return false;
}

/** Identity. */
export function identity<T>(v: T): T {
  return v;
}

/** Constant function factory. */
export function constant<T>(v: T): () => T {
  return () => v;
}

/** Project/feature run(action, id, body?) fire-and-forget. */
export function bindRun(
  // Accept ProjectOpsAction / string / etc. via AnyFn
  run: AnyFn,
  action: string,
  id: string,
  body?: unknown,
): () => void {
  return () => {
    void Promise.resolve(run(action, id, body)).catch(() => undefined);
  };
}

/** Zero-arg async fire-and-forget (banSelected, loadGeo, refresh…). */
export function bindVoid(fn: () => unknown): () => void {
  return () => {
    void Promise.resolve(fn()).catch(() => undefined);
  };
}

/** applyPreset-style (id, danger?, preview?). */
export function bindPreset(
  apply: (id: string, danger?: boolean, preview?: boolean) => unknown,
  id: string,
  danger?: boolean,
  preview?: boolean,
): () => void {
  return () => {
    void Promise.resolve(apply(id, danger, preview)).catch(() => undefined);
  };
}

/** Ban one IP with optional reason. */
export function bindBanOne(
  ban: (ip: string, reason?: string) => unknown,
  ip: string,
  reason?: string,
): () => void {
  return () => {
    void Promise.resolve(ban(ip, reason)).catch(() => undefined);
  };
}

/** void fn(a) — one fixed arg async-safe. */
export function bindCall1<A>(fn: (a: A) => unknown, a: A): () => void {
  return () => {
    void Promise.resolve(fn(a)).catch(() => undefined);
  };
}

/** void fn(a, b) — two fixed args async-safe. */
export function bindCall2<A, B>(fn: (a: A, b: B) => unknown, a: A, b: B): () => void {
  return () => {
    void Promise.resolve(fn(a, b)).catch(() => undefined);
  };
}

/** void fn(a, b, c). */
export function bindCall3<A, B, C>(
  fn: (a: A, b: B, c: C) => unknown,
  a: A,
  b: B,
  c: C,
): () => void {
  return () => {
    void Promise.resolve(fn(a, b, c)).catch(() => undefined);
  };
}

/** Clipboard writeText binder. */
export function bindClipboard(text: string): () => void {
  return () => {
    void navigator.clipboard?.writeText(text);
  };
}

/** Multi setState open-create pattern: set fields then open. */
export function bindOpenCreate(
  open: (v: boolean) => void,
  fields: Array<(v: string) => void>,
  values: string[],
): () => void {
  return () => {
    for (let i = 0; i < fields.length; i++) {
      fields[i](values[i] ?? '');
    }
    open(true);
  };
}

/** withBusy(async () => setter(await loader())) */
export function bindBusySet<T>(
  withBusy: WithBusy,
  loader: AnyFn,
  setter: AnyFn,
): () => void {
  return () => {
    void withBusy(async () => {
      setter(await loader());
    });
  };
}

/** withBusy(async () => setter(map(await loader()))) */
export function bindBusyMap(
  withBusy: WithBusy,
  loader: AnyFn,
  setter: AnyFn,
  map: AnyFn,
): () => void {
  return () => {
    void withBusy(async () => {
      setter(map(await loader()));
    });
  };
}

/** Run two loaders inside withBusy and set results. */
export function bindBusyDual(
  withBusy: WithBusy,
  loadA: () => Promise<unknown>,
  setA: AnyFn,
  loadB: () => Promise<unknown>,
  setB: AnyFn,
): () => void {
  return () => {
    void withBusy(async () => {
      setA(await loadA());
      setB(await loadB());
    });
  };
}

/** Toggle chip: if current===next then clear else select next. */
export function bindToggleValue(
  onChange: (v: string) => void,
  current: string,
  next: string,
): () => void {
  return () => {
    onChange(current === next ? '' : next);
  };
}

/**
 * withBusy: run work(), map result into setter, then optional after().
 * No page-level async arrows when work/after are bound factories.
 */
export function bindBusyWorkThen(
  withBusy: WithBusy,
  work: AnyFn,
  after?: () => Promise<unknown> | unknown,
): () => void {
  return () => {
    void withBusy(async () => {
      await work();
      if (after) await after();
    });
  };
}

/** updateFlags → flagsResultToLog → setLog → load */
export function bindBusyFlagsUpdate(
  withBusy: WithBusy,
  updateFlags: (
    id: string,
    body: any,
  ) => Promise<Record<string, unknown>>,
  domainId: string,
  body: any,
  toLog: (r: Record<string, unknown>) => Record<string, unknown>,
  setLog: (v: Record<string, unknown>) => void,
  load: () => Promise<unknown>,
): () => void {
  return () => {
    void withBusy(async () => {
      const r = await updateFlags(domainId, body);
      setLog(toLog(r));
      await load();
    });
  };
}

/** create/delete then refresh list into setter */
export function bindBusyMutateList<T, R>(
  withBusy: WithBusy,
  mutate: () => Promise<R>,
  setResult: (v: R) => void,
  list: () => Promise<{ items: T[] }>,
  setItems: (v: T[]) => void,
  after?: () => void,
): () => void {
  return () => {
    void withBusy(async () => {
      setResult(await mutate());
      setItems((await list()).items);
      after?.();
    });
  };
}

/** set result then switch tab */
export function bindBusySetAndTab<T>(
  withBusy: WithBusy,
  loader: AnyFn,
  setter: AnyFn,
  setTab: AnyFn,
  tab: string,
): () => void {
  return () => {
    void withBusy(async () => {
      setter(await loader());
      setTab(tab);
    });
  };
}

/** live check + reload */
export function bindBusyLiveReload(
  withBusy: WithBusy,
  liveCheck: () => Promise<unknown>,
  setLive: AnyFn,
  load: () => Promise<unknown>,
): () => void {
  return () => {
    void withBusy(async () => {
      setLive(await liveCheck());
      await load();
    });
  };
}

/** multi-IP RBL with optional host ips fetch */
export function bindBusyDnsblMulti(
  withBusy: WithBusy,
  fetchHostIps: () => Promise<string[]>,
  primaryIp: string | null | undefined,
  dnsblMulti: (ips: string[]) => Promise<unknown>,
  uniqueIps: (primary: string | null | undefined, extra: string[]) => string[],
  setDnsbl: AnyFn,
): () => void {
  return () => {
    void withBusy(async () => {
      let hostIps: string[] = [];
      try {
        hostIps = await fetchHostIps();
      } catch {
        /* optional */
      }
      setDnsbl(await dnsblMulti(uniqueIps(primaryIp, hostIps)));
    });
  };
}

/** autodiscover + set log + clipboard */
export function bindBusyAutodiscover(
  withBusy: WithBusy,
  autodiscover: () => Promise<{
    notes?: unknown;
    mozillaXml: string;
    urls?: unknown;
  }>,
  setLog: (v: Record<string, unknown>) => void,
): () => void {
  return () => {
    void withBusy(async () => {
      const r = await autodiscover();
      setLog({
        ok: true,
        notes: r.notes,
        mozillaXml: r.mozillaXml.slice(0, 200) + '…',
        urls: r.urls,
      });
      void navigator.clipboard?.writeText(r.mozillaXml);
    });
  };
}

/** queue list with slice */
export function bindBusyMailQueue(
  withBusy: WithBusy,
  mailQueue: () => Promise<{ items?: unknown[] } & Record<string, unknown>>,
  setLog: (v: Record<string, unknown>) => void,
  limit = 20,
): () => void {
  return () => {
    void withBusy(async () => {
      const r = await mailQueue();
      setLog({
        ...r,
        items: (r.items ?? []).slice(0, limit),
      });
    });
  };
}

/** bootstrap with password validation */
export function bindBusyBootstrap(
  withBusy: WithBusy,
  password: string,
  isValid: (pw: string) => boolean,
  onInvalid: () => void,
  bootstrap: (body: any) => Promise<unknown>,
  body: any,
  setLog: AnyFn,
  load: () => Promise<unknown>,
): () => void {
  return () => {
    void withBusy(async () => {
      if (!isValid(password)) {
        onInvalid();
        return;
      }
      setLog(await bootstrap(body));
      await load();
    });
  };
}

/** navigate with prebuilt path (avoids arrow at call site) */
export function bindNavTo(
  navigate: AnyFn,
  to: string,
): () => void {
  return () => {
    navigate(to);
  };
}

/** applyPolicy → setLog → load */
export function bindBusyApplyPolicy(
  withBusy: WithBusy,
  applyPolicy: (id: string, body: any) => Promise<unknown>,
  domainId: string,
  body: any,
  setLog: (v: Record<string, unknown>) => void,
  load: () => Promise<unknown>,
): () => void {
  return () => {
    void withBusy(async () => {
      const r = await applyPolicy(domainId, body);
      setLog(r as Record<string, unknown>);
      await load();
    });
  };
}

/** setRelay body → setLog */
export function bindBusySetRelay(
  withBusy: WithBusy,
  setRelay: (body: any) => Promise<unknown>,
  body: any,
  setLog: AnyFn,
): () => void {
  return () => {
    void withBusy(async () => {
      setLog(await setRelay(body));
    });
  };
}

/** webmail SSO from optional password field id */
export function bindBusyWebmailSso(
  withBusy: WithBusy,
  passwordInputId: string,
  email: string,
  domainName: string,
  webmailSso: (body: any) => Promise<unknown>,
  setLog: AnyFn,
  webmailBaseUrl?: string,
): () => void {
  return () => {
    void withBusy(async () => {
      const pwEl = document.getElementById(passwordInputId) as HTMLInputElement | null;
      const password = pwEl?.value || undefined;
      const base =
        webmailBaseUrl?.trim() ||
        `https://webmail.${domainName.replace(/^webmail\./, '')}`;
      setLog(
        await webmailSso({
          email,
          domain: domainName,
          ttlMinutes: 10,
          password,
          webmailBaseUrl: base,
        }),
      );
    });
  };
}

/** write default sieve for postmaster */
export function bindBusyWriteSieve(
  withBusy: WithBusy,
  domainName: string,
  writeSieve: (body: any) => Promise<unknown>,
  setLog: AnyFn,
): () => void {
  return () => {
    void withBusy(async () => {
      const mailbox = `postmaster@${domainName}`;
      setLog(
        await writeSieve({
          mailbox,
          name: 'default.sieve',
          content: `require ["fileinto"];\n# YSK sieve for ${domainName}\n# if header :contains "X-Spam-Flag" "YES" { fileinto "Junk"; stop; }\n`,
        }),
      );
    });
  };
}

/** list sieve for postmaster */
export function bindBusyListSieve(
  withBusy: WithBusy,
  domainName: string,
  listSieve: (mailbox: string) => Promise<unknown>,
  setLog: AnyFn,
): () => void {
  return () => {
    void withBusy(async () => {
      setLog(await listSieve(`postmaster@${domainName}`));
    });
  };
}

/** create mailbox + refresh + close modal */
export function bindBusyCreateMailbox(
  withBusy: WithBusy,
  createMailbox: (
    id: string,
    body: { localPart: string; password?: string },
  ) => Promise<unknown>,
  domainId: string,
  localPart: string,
  password: string,
  setLog: AnyFn,
  listMailboxes: (id: string) => Promise<{ items: unknown[] }>,
  setItems: AnyFn,
  close: AnyFn,
  clearPassword: () => void,
): () => void {
  return () => {
    void withBusy(async () => {
      setLog(
        await createMailbox(domainId, {
          localPart,
          password: password || undefined,
        }),
      );
      setItems((await listMailboxes(domainId)).items);
      close();
      clearPassword();
    });
  };
}

/** useFeatureAction.run(async work, okMsg) binder */
export function bindFeatureRun(
  run: BusyRunner,
  work: AnyFn,
  okMsg?: string,
): () => void {
  return () => {
    void run(async () => work(), okMsg);
  };
}

/** Build selection map for all suspect IPs */
export function selectAllSuspectIps(
  suspects: Array<{ ip: string }>,
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const s of suspects) next[s.ip] = true;
  return next;
}

export function bindSelectAllSuspects(
  setSelected: (v: Record<string, boolean>) => void,
  suspects: Array<{ ip: string }>,
): () => void {
  return () => {
    setSelected(selectAllSuspectIps(suspects));
  };
}

/** Append unique string to list state */
export function bindAppendUnique(
  setList: AnyFn,
  item: string,
): () => void {
  return () => {
    const v = item.trim();
    if (!v) return;
    setList((prev: string[]) => (prev.includes(v) ? prev : [...prev, v]));
  };
}

/** Remove item from string list state */
export function bindListRemove(
  setList: AnyFn,
  item: string,
): () => void {
  return () => {
    setList((prev: string[]) => prev.filter((x: string) => x !== item));
  };
}

/** loadGeo().catch(handler) */
export function bindLoadGeo(
  loadGeo: () => Promise<unknown>,
  onError?: (e: Error) => void,
): () => void {
  return () => {
    void loadGeo().catch((e: Error) => {
      onError?.(e);
    });
  };
}

/** ban then clear input */
export function bindBanAndClear(
  banOne: (ip: string, reason?: string) => unknown,
  ip: string,
  reason: string,
  clearIp: () => void,
): () => void {
  return () => {
    void banOne(ip.trim(), reason);
    clearIp();
  };
}

/** Files: open rename dialog */
export function bindOpenRename(
  setRenameTarget: AnyFn,
  setRenameTo: AnyFn,
  entry: { name: string },
): () => void {
  return () => {
    setRenameTarget(entry);
    setRenameTo(entry.name);
  };
}

/** Files: open move/copy dialog */
export function bindOpenMoveCopy(
  setMoveTarget: AnyFn,
  setMoveDest: AnyFn,
  entries: unknown[],
  mode: 'copy' | 'move',
  path: string,
): () => void {
  return () => {
    setMoveTarget({ entries, mode });
    setMoveDest(path === '.' ? '' : path);
  };
}

/** Files: open share dialog */
export function bindOpenShare(
  setSharePath: AnyFn,
  setSharePass: AnyFn,
  setShareResult: AnyFn,
  path: string,
): () => void {
  return () => {
    setSharePath(path);
    setSharePass('');
    setShareResult(null);
  };
}

/** Files: open zip dialog with default name */
export function bindOpenZip(
  setZipName: AnyFn,
  setZipOpen: AnyFn,
  namePrefix = 'archive',
): () => void {
  return () => {
    setZipName(`${namePrefix}-${Date.now()}.zip`);
    setZipOpen(true);
  };
}

/** Files: open chmod with default mode */
export function bindOpenChmod(
  setChmodMode: AnyFn,
  setChmodOpen: AnyFn,
  mode = '644',
): () => void {
  return () => {
    setChmodMode(mode);
    setChmodOpen(true);
  };
}

/** Side nav: set side + browse tab */
export function bindFilesSide(
  setSide: (id: any) => void,
  setTab: AnyFn,
  id: string,
  tab = 'browse',
): () => void {
  return () => {
    setSide(id);
    setTab(tab);
  };
}

/** Close versions dialog */
export function bindCloseVersions(
  setVersionsPath: AnyFn,
  setVersions: AnyFn,
): () => void {
  return () => {
    setVersionsPath(null);
    setVersions([]);
  };
}

/** onClose when !busy */
export function bindCloseIfIdle(
  busy: boolean,
  close: AnyFn,
): () => void {
  return () => {
    if (!busy) close();
  };
}

/** Defense probe: POST /defense/probe → setStatus → refresh */
export function bindDefenseProbe(
  run: BusyRunner,
  requestRaw: AnyFn,
  // Accept React setState Dispatch (including null union) via any-safe sink
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setStatus: AnyFn,
  refresh: AnyFn,
  okMsg: string,
): () => void {
  return () => {
    void run(async () => {
      const s = await requestRaw('/api/v1/defense/probe', {
        method: 'POST',
        body: '{}',
      });
      setStatus(s);
      await refresh();
      return { ok: true, notes: [] };
    }, okMsg);
  };
}

/** Generic POST defense path with refresh */
export function bindDefensePost(
  run: BusyRunner,
  requestRaw: AnyFn,
  path: string,
  body: unknown,
  refresh: AnyFn,
  okMsg: string,
  mapResult?: (r: unknown) => unknown,
): () => void {
  return () => {
    void run(async () => {
      const r = await requestRaw(path, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      });
      await refresh();
      return mapResult ? mapResult(r) : r;
    }, okMsg);
  };
}

/** Generic PUT defense path */
export function bindDefensePut(
  run: BusyRunner,
  requestRaw: AnyFn,
  path: string,
  body: unknown,
  refresh: AnyFn,
  okMsg: string,
): () => void {
  return () => {
    void run(async () => {
      const r = await requestRaw(path, {
        method: 'PUT',
        body: JSON.stringify(body ?? {}),
      });
      await refresh();
      return r;
    }, okMsg);
  };
}

/** Whitelist POST then refresh */
export function bindDefenseWhitelist(
  run: BusyRunner,
  requestRaw: AnyFn,
  ip: string,
  refresh: AnyFn,
  okMsg: string,
): () => void {
  return () => {
    void run(async () => {
      await requestRaw('/api/v1/defense/whitelist', {
        method: 'POST',
        body: JSON.stringify({ ip }),
      });
      await refresh();
      return { ok: true };
    }, okMsg);
  };
}

/** Unban POST */
export function bindDefenseUnban(
  run: BusyRunner,
  requestRaw: AnyFn,
  ip: string,
  refresh: AnyFn,
  okMsg: string,
): () => void {
  return () => {
    void run(async () => {
      const r = await requestRaw('/api/v1/defense/unban', {
        method: 'POST',
        body: JSON.stringify({ ip }),
      });
      await refresh();
      return r;
    }, okMsg);
  };
}

/** Auto-ban tick */
export function bindDefenseAutoBanTick(
  run: BusyRunner,
  requestRaw: AnyFn,
  refresh: AnyFn,
  okMsg: string,
): () => void {
  return () => {
    void run(async () => {
      const r = await requestRaw('/api/v1/defense/auto-ban/tick', {
        method: 'POST',
        body: '{}',
      });
      await refresh();
      return r;
    }, okMsg);
  };
}

/** Files API run wrappers */
export function bindFilesRun(
  run: BusyRunner,
  work: AnyFn,
  okMsg?: string,
): () => void {
  return () => {
    void run(async () => work(), okMsg);
  };
}

/** Toggle favorite path */
export function bindToggleFavorite(
  run: BusyRunner,
  toggleFavorite: (root: string, path: string) => Promise<unknown>,
  root: string,
  path: string,
  okMsg?: string,
): () => void {
  return () => {
    void run(async () => {
      await toggleFavorite(root, path);
    }, okMsg);
  };
}

// ── Automation / nested save binders (ProtectionPage etc.) ──────────────

/** Top-level boolean checkbox → save({ [key]: checked }) */
export function bindSaveTopChecked(
  save: AnyFn,
  key: string,
): (e: { target: { checked: boolean } }) => void {
  return (e) => {
    void save({ [key]: e.target.checked });
  };
}

/** Nested section checkbox → save({ [section]: { [key]: checked } }) */
export function bindSaveChecked(
  save: AnyFn,
  section: string,
  key: string,
): (e: { target: { checked: boolean } }) => void {
  return (e) => {
    void save({ [section]: { [key]: e.target.checked } });
  };
}

/** Nested section string (SegRadio / chips) → save({ [section]: { [key]: value, ...extra } }) */
export function bindSaveString(
  save: AnyFn,
  section: string,
  key: string,
  extra?: Record<string, unknown>,
): (value: string) => void {
  return (value) => {
    void save({ [section]: { ...(extra ?? {}), [key]: value } });
  };
}

/**
 * Nested number chip: merge into local automation state + save patch.
 * parse overrides Number(v)||fallback (e.g. clampScanIntervalSeconds).
 */
export function bindSaveNumber(
  save: AnyFn,
  setLocal: AnyFn,
  section: string,
  key: string,
  fallback: number,
  parse?: (raw: string) => number,
): (v: string) => void {
  return (v) => {
    const n = parse ? parse(v) : Number(v) || fallback;
    setLocal((a: any) =>
      a ? { ...a, [section]: { ...(a[section] ?? {}), [key]: n } } : a,
    );
    void save({ [section]: { [key]: n } });
  };
}

/** Chip/select → set number with optional min/max clamp */
export function bindChipNumber(
  set: (n: number) => void,
  fallback: number,
  min?: number,
  max?: number,
): (v: string) => void {
  return (v) => {
    let n = Number(v) || fallback;
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    set(n);
  };
}

/** Append value to string[] state if not already present; optional bool flag set */
export function bindAppendUniqueStr(
  setList: AnyFn,
  value: string,
  setFlag?: AnyFn,
  flagValue = true,
): () => void {
  return () => {
    setList((p: string[]) => (p.includes(value) ? p : [...p, value]));
    setFlag?.(flagValue);
  };
}

/** Clear error/msg then refresh (Fail2ban / similar toolbars) */
export function bindRefreshClear(
  setError: AnyFn,
  setMsg: AnyFn,
  refresh: AnyFn,
): () => void {
  return () => {
    setError(null);
    setMsg(null);
    void refresh();
  };
}

/** run(apiFn() → optional refresh) with 0 args on the API */
export function bindApiRefresh0(
  run: BusyRunner,
  apiFn: AnyFn,
  refresh: AnyFn | null | undefined,
  okMsg: string,
  clearSet?: AnyFn,
): () => void {
  return () => {
    void run(async () => {
      const r = await apiFn();
      clearSet?.('');
      if (refresh) await refresh();
      return r;
    }, okMsg);
  };
}

/** run(apiFn(a) → optional refresh) */
export function bindApiRefresh1<A>(
  run: BusyRunner,
  apiFn: AnyFn,
  a: A,
  refresh: AnyFn | null | undefined,
  okMsg: string,
  clearSet?: AnyFn,
): () => void {
  return () => {
    void run(async () => {
      const r = await apiFn(a);
      clearSet?.('');
      if (refresh) await refresh();
      return r;
    }, okMsg);
  };
}

/** run(apiFn(a,b) → optional refresh) */
export function bindApiRefresh2<A, B>(
  run: BusyRunner,
  apiFn: AnyFn,
  a: A,
  b: B,
  refresh: AnyFn | null | undefined,
  okMsg: string,
  clearSet?: AnyFn,
): () => void {
  return () => {
    void run(async () => {
      const r = await apiFn(a, b);
      clearSet?.('');
      if (refresh) await refresh();
      return r;
    }, okMsg);
  };
}

/** run(apiFn(a,b,c) → optional refresh) */
export function bindApiRefresh3<A, B, C>(
  run: BusyRunner,
  apiFn: AnyFn,
  a: A,
  b: B,
  c: C,
  refresh: AnyFn | null | undefined,
  okMsg: string,
  clearSet?: AnyFn,
): () => void {
  return () => {
    void run(async () => {
      const r = await apiFn(a, b, c);
      clearSet?.('');
      if (refresh) await refresh();
      return r;
    }, okMsg);
  };
}

/** Defense whitelist with action + optional string field clear (no call-site arrow) */
export function bindDefenseWhitelistAction(
  run: BusyRunner,
  requestRaw: AnyFn,
  ip: string,
  action: 'add' | 'remove',
  refresh: AnyFn,
  okMsg: string,
  clearSet?: AnyFn,
  notes?: string[],
): () => void {
  return () => {
    void run(async () => {
      await requestRaw('/api/v1/defense/whitelist', {
        method: 'POST',
        body: JSON.stringify({ ip, action }),
      });
      clearSet?.('');
      await refresh();
      return { ok: true, notes: notes ?? [] };
    }, okMsg);
  };
}

/** Cloudflare zone save from free-text + current automation snapshot */
export function bindSaveCfZones(
  save: AnyFn,
  zonesText: string,
  ufwAllowOnlyCf: boolean | undefined,
  ufwKeepTcpPorts: number[] | undefined,
): () => void {
  return () => {
    void save({
      cloudflare: {
        enabled: true,
        zones: zonesText
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        onAutoEscalate: true,
        ufwAllowOnlyCf,
        ufwKeepTcpPorts: ufwKeepTcpPorts ?? [22],
      },
    });
  };
}

/** POST body then return result (no refresh) — e.g. CF under-attack */
export function bindDefensePostOnly(
  run: BusyRunner,
  requestRaw: AnyFn,
  path: string,
  body: unknown,
  okMsg: string,
): () => void {
  return () => {
    void run(async () => {
      return requestRaw(path, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      });
    }, okMsg);
  };
}



/** GeoIP apply snippet */
export function bindDefenseGeoApply(
  run: BusyRunner,
  requestRaw: AnyFn,
  okMsg: string,
): () => void {
  return () => {
    void run(async () => {
      const r = (await requestRaw('/api/v1/defense/geoip/apply', {
        method: 'POST',
        body: '{}',
      })) as { ok: boolean; notes?: string[] };
      return { ok: r.ok, notes: r.notes ?? [] };
    }, okMsg);
  };
}

/** SegRadio/select: map sentinel (e.g. "all") to empty string */
export function bindAllOrValue(
  set: AnyFn,
  allToken = 'all',
): (v: string) => void {
  return (v) => {
    set(v === allToken ? '' : v);
  };
}

/** Input change + context store patch (server IP fields) */
export function bindInputContext(
  set: AnyFn,
  setCtx: (patch: Record<string, string>) => void,
  ctxKey: string,
): (e: { target: { value: string } }) => void {
  return (e) => {
    set(e.target.value);
    setCtx({ [ctxKey]: e.target.value });
  };
}

/** refresh().catch(e => setError(e.message)) */
export function bindRefreshCatch(
  refresh: AnyFn,
  setError: AnyFn,
): () => void {
  return () => {
    void refresh().catch((e: Error) => setError(e.message));
  };
}

/** form onSubmit: preventDefault + call named handler (accepts React FormEvent) */
export function bindFormSubmit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (e: any) => unknown,
): (e: { preventDefault(): void }) => void {
  return (e) => {
    e.preventDefault();
    void fn(e);
  };
}

/** Select/string setState from event.target.value (native <select>) */
export function bindSelect(
  set: AnyFn,
): (e: { target: { value: string } }) => void {
  return (e) => {
    set(e.target.value);
  };
}

/** call named async with fixed args via void (postSiteOp etc.) */
export function bindVoidCall2<A, B>(
  fn: (a: A, b: B) => unknown,
  a: A,
  b: B,
): () => void {
  return () => {
    void fn(a, b);
  };
}

export function bindVoidCall3<A, B, C>(
  fn: (a: A, b: B, c: C) => unknown,
  a: A,
  b: B,
  c: C,
): () => void {
  return () => {
    void fn(a, b, c);
  };
}

/** Close modal + run reset (no call-site arrow) */
export function bindCloseReset(
  setOpen: AnyFn,
  reset: AnyFn,
  openValue = false,
): () => void {
  return () => {
    setOpen(openValue);
    reset();
  };
}

/** Primary refresh + optional second refresh when cond */
export function bindRefreshDual(
  primary: AnyFn,
  secondary: AnyFn,
  cond: boolean,
): () => void {
  return () => {
    void primary();
    if (cond) void secondary();
  };
}

/** Confirm dialog: close then void action */
export function bindConfirmThen(
  setOpen: AnyFn,
  action: AnyFn,
  openValue = false,
): () => void {
  return () => {
    setOpen(openValue);
    void action();
  };
}

/** Confirm dialog with null-clear then action(arg) */
/** Draft object number field from chip/select string */
export function bindDraftNumber(
  setDraft: AnyFn,
  key: string,
  fallback: number,
): (v: string) => void {
  return (v) => {
    setDraft((d: any) => ({ ...d, [key]: Number(v) || fallback }));
  };
}

/** Draft object boolean from checkbox */
export function bindDraftCheck(
  setDraft: AnyFn,
  key: string,
): (e: { target: { checked: boolean } }) => void {
  return (e) => {
    setDraft((d: any) => ({ ...d, [key]: e.target.checked }));
  };
}

/** Draft object string field */
export function bindDraftString(
  setDraft: AnyFn,
  key: string,
): (v: string) => void {
  return (v) => {
    setDraft((d: any) => ({ ...d, [key]: v }));
  };
}

/** Toggle bool + set tab string (logs projectsOnly chip) */
export function bindToggleAndTab(
  setBool: (updater: (v: boolean) => boolean) => void,
  setTab: AnyFn,
  tab: string,
): () => void {
  return () => {
    setBool((v) => !v);
    setTab(tab);
  };
}

/** Copy text then set message */
export function bindCopyMsg(
  text: string,
  setMsg: AnyFn,
  msg: string,
): () => void {
  return () => {
    void navigator.clipboard?.writeText(text);
    setMsg(msg);
  };
}

/** Copy text then onFlash(tone, msg) */
export function bindCopyFlash(
  text: string,
  onFlash: (tone: 'ok' | 'error', text: string) => void,
  msg: string,
  tone: 'ok' | 'error' = 'ok',
): () => void {
  return () => {
    void navigator.clipboard?.writeText(text);
    onFlash(tone, msg);
  };
}

/** SegRadio/value → setState (identity binder; collapses call-site arrows) */
export function bindValueSet<T>(set: AnyFn): (v: T) => void {
  return (v) => {
    set(v);
  };
}

/** input onChange → call(value) (not setState) */
export function bindInputCall(
  fn: (v: string) => void,
): (e: { target: { value: string } }) => void {
  return (e) => {
    fn(e.target.value);
  };
}

/** checkbox onChange → call(checked) */
export function bindCheckCall(
  fn: (v: boolean) => void,
): (e: { target: { checked: boolean } }) => void {
  return (e) => {
    fn(e.target.checked);
  };
}

/** list.setFilter(key, value) chip/filter binder */
export function bindFilter(
  setFilter: (key: string, value: string) => void,
  key: string,
): (value: string) => void {
  return (value) => {
    setFilter(key, value);
  };
}

/** Confirm delete: if id then remove(id).then(clear null) */
export function bindRemoveIf(
  id: string | null | undefined,
  remove: (id: string) => Promise<unknown> | unknown,
  clear: (v: null) => void,
): () => void {
  return () => {
    if (id) void Promise.resolve(remove(id)).then(() => clear(null));
  };
}

/** Clear two nullable message fields */
export function bindClear2(
  a: ((v: null) => void) | undefined | null,
  b: ((v: null) => void) | undefined | null,
): () => void {
  return () => {
    a?.(null);
    b?.(null);
  };
}

/** Clear three nullable fields */
export function bindClear3(
  a: ((v: null) => void) | undefined | null,
  b: ((v: null) => void) | undefined | null,
  c: ((v: null) => void) | undefined | null,
): () => void {
  return () => {
    a?.(null);
    b?.(null);
    c?.(null);
  };
}
