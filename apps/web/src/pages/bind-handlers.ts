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
