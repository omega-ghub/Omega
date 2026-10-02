// Where encoded bytes go. Long exports stream to disk through positioned
// writes (window.omega.files.openWrite/writeAt/closeWrite): Mediabunny's
// StreamTarget hands us chunks that carry their byte offset, the main process
// writes them into `<path>.partial`, and closing renames the file into place.
// Nothing ever holds the whole file in memory. If the streaming IPC is
// missing (an older preload), we fall back to an in-memory buffer.

import { BufferTarget, StreamTarget, type StreamTargetChunk, type Target } from 'mediabunny';

export interface FileSink {
  readonly target: Target;
  readonly path: string;
  readonly streaming: boolean;
  /** Bytes handed to the disk so far. */
  written(): number;
  /** Flushes, closes and moves the file into place; resolves with its size. */
  finish(): Promise<number>;
  /** Stops writing and deletes the partial file. Safe to call more than once. */
  abort(): Promise<void>;
}

const MiB = 1024 * 1024;

function exactBuffer(data: Uint8Array): ArrayBuffer {
  // IPC structured-clones the whole backing buffer of a view; send only the bytes we mean.
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) return data.buffer as ArrayBuffer;
  return data.slice().buffer as ArrayBuffer;
}

export async function openFileSink(path: string): Promise<FileSink> {
  const files = window.omega?.files;
  if (!files?.openWrite) return memorySink(path);

  let handle: number;
  try {
    handle = await files.openWrite(path);
  } catch (err) {
    throw new Error(`Can't create "${path}": ${(err as Error).message}`);
  }
  let aborted = false;
  let closed = false;
  let bytes = 0;
  const writable = new WritableStream<StreamTargetChunk>(
    {
      async write(chunk) {
        if (aborted) return;
        await files.writeAt(handle, exactBuffer(chunk.data), chunk.position);
        bytes = Math.max(bytes, chunk.position + chunk.data.byteLength);
      },
    },
    // Up to 64 MiB in flight before the muxer (and the encoders behind it) wait.
    { highWaterMark: 64 * MiB, size: (chunk) => chunk.data.byteLength },
  );
  const target = new StreamTarget(writable, { chunked: true, chunkSize: 8 * MiB });
  return {
    target,
    path,
    streaming: true,
    written: () => bytes,
    async finish() {
      closed = true;
      try {
        return await files.closeWrite(handle);
      } catch (err) {
        throw new Error(`Can't finish writing "${path}": ${(err as Error).message}`);
      }
    },
    async abort() {
      if (aborted) return;
      aborted = true;
      if (closed) return;
      closed = true;
      await files.closeWrite(handle, { discard: true }).catch(() => undefined);
    },
  };
}

function memorySink(path: string): FileSink {
  const target = new BufferTarget();
  return {
    target,
    path,
    streaming: false,
    written: () => 0,
    async finish() {
      const buf = target.buffer;
      if (!buf) throw new Error('The encoder produced no output.');
      await window.omega.files.writeBinary(path, buf);
      return buf.byteLength;
    },
    async abort() {},
  };
}
