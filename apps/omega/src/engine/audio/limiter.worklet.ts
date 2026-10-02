// AudioWorklet wrapper around the lookahead true-peak limiter (limiterCore).
// graph.ts loads it with `?worker&url`, so Vite bundles it into a same-origin
// file (the module CSP only allows 'self' scripts). Allocation-free in
// process().
//
// When a plain bundler (esbuild in unit tests) inlines this module instead,
// the default export is an empty URL (graph.ts then uses the compressor
// fallback) and nothing is registered, because AudioWorkletProcessor only
// exists inside an AudioWorkletGlobalScope.

import { LIMITER_LOOKAHEAD_MS, LIMITER_RELEASE_MS, LookaheadLimiter } from './limiterCore';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const inWorklet = typeof registerProcessor === 'function' && typeof AudioWorkletProcessor === 'function';

if (inWorklet) {
  class OmegaLimiterProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [
        { name: 'ceiling', defaultValue: -1, minValue: -60, maxValue: 0, automationRate: 'k-rate' },
        { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      ];
    }

    private readonly lim = new LookaheadLimiter(sampleRate, 2, { lookaheadMs: LIMITER_LOOKAHEAD_MS, releaseMs: LIMITER_RELEASE_MS, truePeak: true });
    private readonly none: Float32Array[] = [];
    private lastCeiling = Number.NaN;

    process(inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>): boolean {
      const out = outputs[0];
      if (!out || !out.length) return true;
      const c = params.ceiling[0];
      if (c !== this.lastCeiling) {
        this.lastCeiling = c;
        // aim a hair under the ceiling for the interpolator's passband ripple
        this.lim.setCeiling(Math.pow(10, (c - 0.1) / 20));
      }
      this.lim.setEnabled(params.enabled[0] >= 0.5);
      this.lim.process(inputs[0] ?? this.none, out, out[0].length);
      return true;
    }
  }
  registerProcessor('omega-limiter', OmegaLimiterProcessor);
}

/** Only meaningful when inlined by a non-Vite bundler: no worklet URL. */
const noUrl = '';
export default noUrl;
