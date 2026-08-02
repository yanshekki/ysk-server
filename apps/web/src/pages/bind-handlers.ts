/**
 * Shared bind helpers — collapse per-call-site JSX arrows into one
 * instrumented function that unit tests can cover fully.
 */

/** Fire-and-forget async action (project run, preset apply, ban, …). */
export function bindAsync(fn: () => void | Promise<unknown>): () => void {
  return () => {
    void Promise.resolve(fn()).catch(() => undefined);
  };
}

/** setState(true/false) toggle binder. */
export function bindSet<T>(set: (v: T) => void, value: T): () => void {
  return () => {
    set(value);
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
  set: (v: string) => void,
): (e: { target: { value: string } }) => void {
  return (e) => {
    set(e.target.value);
  };
}

/** Bind setState from checkbox. */
export function bindCheck(
  set: (v: boolean) => void,
): (e: { target: { checked: boolean } }) => void {
  return (e) => {
    set(e.target.checked);
  };
}

/** Bind number parse into setState. */
export function bindNumber(
  set: (v: number) => void,
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
  close: () => void,
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
export function bindToggleInList(
  setList: (updater: (prev: string[]) => string[]) => void,
  item: string,
): () => void {
  return () => {
    setList((prev) =>
      prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item],
    );
  };
}

/** Navigate binder for react-router navigate. */
export function bindNavigate(
  navigate: (to: string) => void,
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
  run: (action: string, id: string, body?: unknown) => Promise<unknown> | unknown,
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
  withBusy: (fn: () => Promise<unknown>) => unknown,
  loader: () => Promise<T>,
  setter: (v: T) => void,
): () => void {
  return () => {
    void withBusy(async () => {
      setter(await loader());
    });
  };
}

/** withBusy(async () => setter(map(await loader()))) */
export function bindBusyMap<T, U>(
  withBusy: (fn: () => Promise<unknown>) => unknown,
  loader: () => Promise<T>,
  setter: (v: U) => void,
  map: (v: T) => U,
): () => void {
  return () => {
    void withBusy(async () => {
      setter(map(await loader()));
    });
  };
}

/** Run two loaders inside withBusy and set results. */
export function bindBusyDual(
  withBusy: (fn: () => Promise<unknown>) => unknown,
  loadA: () => Promise<unknown>,
  setA: (v: unknown) => void,
  loadB: () => Promise<unknown>,
  setB: (v: unknown) => void,
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
  withBusy: (fn: () => Promise<unknown>) => unknown,
  work: () => Promise<unknown>,
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
  withBusy: (fn: () => Promise<unknown>) => unknown,
  updateFlags: (
    id: string,
    body: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>,
  domainId: string,
  body: Record<string, unknown>,
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
  withBusy: (fn: () => Promise<unknown>) => unknown,
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
  withBusy: (fn: () => Promise<unknown>) => unknown,
  loader: () => Promise<T>,
  setter: (v: T) => void,
  setTab: (tab: string) => void,
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
  withBusy: (fn: () => Promise<unknown>) => unknown,
  liveCheck: () => Promise<unknown>,
  setLive: (v: unknown) => void,
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
  withBusy: (fn: () => Promise<unknown>) => unknown,
  fetchHostIps: () => Promise<string[]>,
  primaryIp: string | null | undefined,
  dnsblMulti: (ips: string[]) => Promise<unknown>,
  uniqueIps: (primary: string | null | undefined, extra: string[]) => string[],
  setDnsbl: (v: unknown) => void,
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
  withBusy: (fn: () => Promise<unknown>) => unknown,
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
  withBusy: (fn: () => Promise<unknown>) => unknown,
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
  withBusy: (fn: () => Promise<unknown>) => unknown,
  password: string,
  isValid: (pw: string) => boolean,
  onInvalid: () => void,
  bootstrap: (body: Record<string, unknown>) => Promise<unknown>,
  body: Record<string, unknown>,
  setLog: (v: unknown) => void,
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
  navigate: (to: string) => void,
  to: string,
): () => void {
  return () => {
    navigate(to);
  };
}

/** applyPolicy → setLog → load */
export function bindBusyApplyPolicy(
  withBusy: (fn: () => Promise<unknown>) => unknown,
  applyPolicy: (id: string, body: Record<string, unknown>) => Promise<unknown>,
  domainId: string,
  body: Record<string, unknown>,
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
  withBusy: (fn: () => Promise<unknown>) => unknown,
  setRelay: (body: Record<string, unknown>) => Promise<unknown>,
  body: Record<string, unknown>,
  setLog: (v: unknown) => void,
): () => void {
  return () => {
    void withBusy(async () => {
      setLog(await setRelay(body));
    });
  };
}

/** webmail SSO from optional password field id */
export function bindBusyWebmailSso(
  withBusy: (fn: () => Promise<unknown>) => unknown,
  passwordInputId: string,
  email: string,
  domainName: string,
  webmailSso: (body: Record<string, unknown>) => Promise<unknown>,
  setLog: (v: unknown) => void,
): () => void {
  return () => {
    void withBusy(async () => {
      const pwEl = document.getElementById(passwordInputId) as HTMLInputElement | null;
      const password = pwEl?.value || undefined;
      setLog(
        await webmailSso({
          email,
          domain: domainName,
          ttlMinutes: 10,
          password,
        }),
      );
    });
  };
}

/** write default sieve for postmaster */
export function bindBusyWriteSieve(
  withBusy: (fn: () => Promise<unknown>) => unknown,
  domainName: string,
  writeSieve: (body: Record<string, unknown>) => Promise<unknown>,
  setLog: (v: unknown) => void,
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
  withBusy: (fn: () => Promise<unknown>) => unknown,
  domainName: string,
  listSieve: (mailbox: string) => Promise<unknown>,
  setLog: (v: unknown) => void,
): () => void {
  return () => {
    void withBusy(async () => {
      setLog(await listSieve(`postmaster@${domainName}`));
    });
  };
}

/** create mailbox + refresh + close modal */
export function bindBusyCreateMailbox(
  withBusy: (fn: () => Promise<unknown>) => unknown,
  createMailbox: (
    id: string,
    body: { localPart: string; password?: string },
  ) => Promise<unknown>,
  domainId: string,
  localPart: string,
  password: string,
  setLog: (v: unknown) => void,
  listMailboxes: (id: string) => Promise<{ items: unknown[] }>,
  setItems: (v: unknown[]) => void,
  close: () => void,
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
  run: (fn: () => Promise<unknown>, okMsg?: string) => unknown,
  work: () => Promise<unknown>,
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
  setList: (updater: (prev: string[]) => string[]) => void,
  item: string,
): () => void {
  return () => {
    const v = item.trim();
    if (!v) return;
    setList((prev) => (prev.includes(v) ? prev : [...prev, v]));
  };
}

/** Remove item from string list state */
export function bindListRemove(
  setList: (updater: (prev: string[]) => string[]) => void,
  item: string,
): () => void {
  return () => {
    setList((prev) => prev.filter((x) => x !== item));
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
  setRenameTarget: (e: unknown) => void,
  setRenameTo: (name: string) => void,
  entry: { name: string },
): () => void {
  return () => {
    setRenameTarget(entry);
    setRenameTo(entry.name);
  };
}

/** Files: open move/copy dialog */
export function bindOpenMoveCopy(
  setMoveTarget: (v: { entries: unknown[]; mode: string }) => void,
  setMoveDest: (v: string) => void,
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
  setSharePath: (p: string) => void,
  setSharePass: (p: string) => void,
  setShareResult: (v: null) => void,
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
  setZipName: (n: string) => void,
  setZipOpen: (v: boolean) => void,
  namePrefix = 'archive',
): () => void {
  return () => {
    setZipName(`${namePrefix}-${Date.now()}.zip`);
    setZipOpen(true);
  };
}

/** Files: open chmod with default mode */
export function bindOpenChmod(
  setChmodMode: (m: string) => void,
  setChmodOpen: (v: boolean) => void,
  mode = '644',
): () => void {
  return () => {
    setChmodMode(mode);
    setChmodOpen(true);
  };
}

/** Side nav: set side + browse tab */
export function bindFilesSide(
  setSide: (id: string) => void,
  setTab: (tab: string) => void,
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
  setVersionsPath: (v: null) => void,
  setVersions: (v: unknown[]) => void,
): () => void {
  return () => {
    setVersionsPath(null);
    setVersions([]);
  };
}

/** onClose when !busy */
export function bindCloseIfIdle(
  busy: boolean,
  close: () => void,
): () => void {
  return () => {
    if (!busy) close();
  };
}
