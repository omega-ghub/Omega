// Transport: the single way any package controls playback. The viewer
// package installs the real implementation (setTransportImpl); until then
// seeking just moves the playhead.

import { useEditor } from '../../state/store';

export interface TransportImpl {
  play(): void;
  pause(): void;
  toggle(): void;
  /** Timeline seconds; clamps to the sequence. */
  seek(t: number): void;
  /** J/K/L shuttle: negative = reverse. 0 = stop. */
  shuttle(rate: number): void;
  /** Step by whole frames (negative = back). */
  step(frames: number): void;
  isPlaying(): boolean;
  /** Plays from `from` to `to` once (used for previewing trims and play-around). */
  playRange?(from: number, to: number): void;
}

let impl: TransportImpl | null = null;

export function setTransportImpl(next: TransportImpl | null) {
  impl = next;
}

export const transport: TransportImpl = {
  play: () => impl?.play(),
  pause: () => impl?.pause(),
  toggle: () => impl?.toggle(),
  seek: (t) => (impl ? impl.seek(t) : useEditor.getState().setPlayhead(t)),
  shuttle: (r) => impl?.shuttle(r),
  step: (n) => impl?.step(n),
  isPlaying: () => impl?.isPlaying() ?? false,
  playRange: (a, b) => impl?.playRange?.(a, b),
};
