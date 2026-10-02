// Runs scope analysis in a Web Worker, with a main-thread fallback when
// workers are unavailable (or the worker fails to load). OWNED BY THE COLOR PACKAGE.
import { analyze, type RGBAFrame, type ScopeRequest, type ScopeResult } from './scopes';
import type { ScopeJob, ScopeJobResult } from './scopes.worker';

type Pending = { resolve: (r: ScopeResult) => void; reject: (e: Error) => void; frame: RGBAFrame; req: ScopeRequest };

export class ScopeEngine {
  private worker: Worker | null = null;
  private failed = false;
  private seq = 0;
  private pending = new Map<number, Pending>();

  private ensureWorker(): Worker | null {
    if (this.worker || this.failed) return this.worker;
    try {
      if (typeof Worker === 'undefined') throw new Error('no Worker');
      const w = new Worker(new URL('./scopes.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<ScopeJobResult>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.result) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error ?? 'scope worker error'));
      };
      w.onerror = (e) => {
        e.preventDefault?.();
        this.fallback();
      };
      this.worker = w;
    } catch {
      this.failed = true;
    }
    return this.worker;
  }

  /** Worker failed: compute everything still in flight on the main thread. */
  private fallback() {
    this.failed = true;
    this.worker?.terminate();
    this.worker = null;
    const jobs = [...this.pending.values()];
    this.pending.clear();
    for (const p of jobs) {
      try {
        p.resolve(analyze(p.frame, p.req));
      } catch (err) {
        p.reject(err as Error);
      }
    }
  }

  /** True when computation runs off the main thread. */
  get threaded(): boolean {
    return !!this.worker && !this.failed;
  }

  /** Analyzes a frame. The frame's pixels are copied, so the caller keeps its buffer. */
  compute(frame: RGBAFrame, req: ScopeRequest): Promise<ScopeResult> {
    const w = this.ensureWorker();
    if (!w) return Promise.resolve(analyze(frame, req));
    const id = ++this.seq;
    const copy = new Uint8ClampedArray(frame.width * frame.height * 4);
    copy.set(frame.data.subarray(0, copy.length));
    return new Promise<ScopeResult>((resolve, reject) => {
      // keep a main-thread copy only for the fallback path
      this.pending.set(id, { resolve, reject, frame: { width: frame.width, height: frame.height, data: copy.slice() }, req });
      const job: ScopeJob = { id, width: frame.width, height: frame.height, buffer: copy.buffer, req };
      w.postMessage(job, [copy.buffer]);
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    const jobs = [...this.pending.values()];
    this.pending.clear();
    for (const p of jobs) p.reject(new Error('scope engine disposed'));
  }
}
