// LUT files (.cube 1D/3D). OWNED BY THE RENDERER PACKAGE.
export interface ParsedLut {
  title: string;
  /** 3D: size N, data N^3 RGB floats (r fastest). 1D: size N, data N RGB floats. */
  kind: '1d' | '3d';
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  data: Float32Array;
}

export function parseCube(_text: string): ParsedLut {
  throw new Error('parseCube is not implemented yet');
}

/** Loads (and caches) a project LUT by id so the renderer can use it. */
export async function loadLut(_id: string, _path: string): Promise<ParsedLut> {
  throw new Error('loadLut is not implemented yet');
}

/** A loaded LUT, or null if not loaded yet (renderer skips it until ready). */
export function getLoadedLut(_id: string): ParsedLut | null {
  return null;
}
