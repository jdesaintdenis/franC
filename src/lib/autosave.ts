export interface AutosaveOptions<T> {
  delayMs: number;
  save: (value: T) => Promise<void> | void;
  /** Defaults to `Object.is`. */
  equals?: (a: T, b: T) => boolean;
}

export interface Autosave<T> {
  /** Saves `value` after `delayMs` without a newer call. */
  schedule: (value: T) => void;
  /** Saves the pending value now, if there is one and it differs from the last saved. */
  flush: () => Promise<void>;
  /** Drops the pending value without saving. */
  cancel: () => void;
  /** Seeds (or updates) what is already stored, so an unchanged value is not saved again. */
  setSaved: (value: T) => void;
  hasPending: () => boolean;
}

/** A framework-free debouncer: the last value scheduled wins, and unchanged values are skipped. */
export function createAutosave<T>({ delayMs, save, equals = Object.is }: AutosaveOptions<T>): Autosave<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  let saved: { value: T } | null = null;

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  async function run(): Promise<void> {
    clearTimer();
    const job = pending;
    pending = null;
    if (!job) return;
    if (saved && equals(saved.value, job.value)) return;
    await save(job.value);
    saved = job;
  }

  return {
    schedule(value) {
      pending = { value };
      clearTimer();
      timer = setTimeout(() => void run(), delayMs);
    },
    flush: run,
    cancel() {
      clearTimer();
      pending = null;
    },
    setSaved(value) {
      saved = { value };
    },
    hasPending: () => pending !== null,
  };
}
