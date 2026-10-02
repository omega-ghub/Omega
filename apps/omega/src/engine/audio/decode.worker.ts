// Dedicated worker that decodes audio off the main thread (the UI thread is
// busy with video decode and WebGL during playback). Results are transferred,
// never copied.

import { decodeAudio, type DecodeRequest, type DecodeResult } from './decodeCore';

interface Job {
  id: number;
  req: DecodeRequest;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Job>) => void) | null;
  postMessage(msg: unknown, transfer: Transferable[]): void;
};

scope.onmessage = async (e) => {
  const { id, req } = e.data;
  const res: DecodeResult = await decodeAudio(req);
  const transfer: Transferable[] = [];
  for (const c of res.channels) transfer.push(c.buffer);
  for (const p of res.peaks ?? []) transfer.push(p.data.buffer);
  scope.postMessage({ id, res }, transfer);
};
