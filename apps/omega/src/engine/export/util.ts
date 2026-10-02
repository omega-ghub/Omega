// Small async helpers for the export loop.

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'ExportCancelled';
  }
}

/** An export problem with a message meant for the user. */
export class ExportFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportFailed';
  }
}

export function isCancel(err: unknown): boolean {
  return err instanceof ExportCancelled || (err instanceof DOMException && err.name === 'AbortError');
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new ExportCancelled();
}

/** Rejects with ExportFailed(message) if `p` takes longer than `ms`; rejects with ExportCancelled on abort. */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ExportFailed(message)), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ExportCancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/**
 * Yields to the event loop with a timer task, so input, progress updates and
 * painting get their turn between frames (continuation-priority yields such
 * as scheduler.yield() can starve rendering during a long export).
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/** Opt-in export diagnostics: localStorage['delta.debugExport'] = '1'. */
export function exportDebug(...args: unknown[]): void {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('delta.debugExport') === '1') console.info('[deliver]', ...args);
  } catch {
    /* ignore */
  }
}
