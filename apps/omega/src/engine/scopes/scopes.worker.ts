// Scope computation off the main thread. OWNED BY THE COLOR PACKAGE.
// Receives one RGBA8 frame (transferred), runs `analyze`, and transfers the
// finished scope images back, so the UI thread only blits pixels.
import { analyze, type ScopeRequest, type ScopeResult } from './scopes';

export interface ScopeJob {
  id: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  req: ScopeRequest;
}

export interface ScopeJobResult {
  id: number;
  result?: ScopeResult;
  error?: string;
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<ScopeJob>) => void) | null; postMessage(msg: unknown, transfer: Transferable[]): void };

scope.onmessage = (e) => {
  const { id, width, height, buffer, req } = e.data;
  try {
    const result = analyze({ width, height, data: new Uint8ClampedArray(buffer) }, req);
    const transfer: Transferable[] = [];
    for (const img of [result.waveform, result.parade, result.vectorscope]) if (img) transfer.push(img.data.buffer as ArrayBuffer);
    if (result.histogram) for (const k of ['r', 'g', 'b', 'y'] as const) transfer.push(result.histogram[k].buffer as ArrayBuffer);
    scope.postMessage({ id, result } satisfies ScopeJobResult, transfer);
  } catch (err) {
    scope.postMessage({ id, error: (err as Error).message } satisfies ScopeJobResult, []);
  }
};
