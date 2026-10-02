// Low-level WebGL2 plumbing for the compositor: render-target pool, program
// cache with sampler-unit bookkeeping, and fullscreen/quad geometry.
// OWNED BY THE RENDERER PACKAGE.

export type GL = WebGL2RenderingContext;

/** A texture with its framebuffer (render target). */
export interface RT {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
  fmt: number;
  /** Frame number of last use (pool eviction). */
  used: number;
}

export interface Program {
  prog: WebGLProgram;
  /** Uniform locations by name (null when optimized out). */
  loc(name: string): WebGLUniformLocation | null;
  /** Sampler uniforms → texture unit and target, assigned at link time. */
  samplers: { name: string; unit: number; target: number }[];
}

export const VS_FULL = /* glsl */ `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const VS_QUAD = /* glsl */ `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

function compile(gl: GL, type: number, src: string): { shader: WebGLShader | null; log: string } {
  const s = gl.createShader(type);
  if (!s) return { shader: null, log: 'createShader failed' };
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s) ?? 'unknown compile error';
    gl.deleteShader(s);
    return { shader: null, log };
  }
  return { shader: s, log: '' };
}

/** Caches linked programs by their full source; failed sources are remembered (and logged once). */
export class ProgramCache {
  private progs = new Map<string, Map<string, Program | null>>();
  private vsCache = new Map<string, WebGLShader>();
  readonly errors = new Map<string, string>();

  constructor(private gl: GL) {}

  get(vs: string, fs: string, label = 'shader'): Program | null {
    let byFs = this.progs.get(vs);
    if (!byFs) this.progs.set(vs, (byFs = new Map()));
    const have = byFs.get(fs);
    if (have !== undefined) return have;
    const p = this.build(vs, fs, label);
    byFs.set(fs, p);
    return p;
  }

  /** Error for a source that failed to compile (or undefined). */
  errorFor(fs: string): string | undefined {
    return this.errors.get(fs);
  }

  private build(vs: string, fs: string, label: string): Program | null {
    const gl = this.gl;
    let v = this.vsCache.get(vs);
    if (!v) {
      const r = compile(gl, gl.VERTEX_SHADER, vs);
      if (!r.shader) {
        console.error(`[renderer] vertex shader failed: ${r.log}`);
        return null;
      }
      v = r.shader;
      this.vsCache.set(vs, v);
    }
    const f = compile(gl, gl.FRAGMENT_SHADER, fs);
    if (!f.shader) {
      this.errors.set(fs, f.log);
      if (!gl.isContextLost()) console.error(`[renderer] ${label}: GLSL compile error (skipped):\n${f.log}`);
      return null;
    }
    const prog = gl.createProgram();
    if (!prog) return null;
    gl.attachShader(prog, v);
    gl.attachShader(prog, f.shader);
    gl.linkProgram(prog);
    gl.deleteShader(f.shader);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? 'unknown link error';
      this.errors.set(fs, log);
      if (!gl.isContextLost()) console.error(`[renderer] ${label}: GLSL link error (skipped):\n${log}`);
      gl.deleteProgram(prog);
      return null;
    }
    const locs = new Map<string, WebGLUniformLocation | null>();
    const samplers: Program['samplers'] = [];
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    gl.useProgram(prog);
    let unit = 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(prog, info.name);
      locs.set(name, loc);
      let target = 0;
      if (info.type === gl.SAMPLER_2D || info.type === gl.INT_SAMPLER_2D || info.type === gl.UNSIGNED_INT_SAMPLER_2D) target = gl.TEXTURE_2D;
      else if (info.type === gl.SAMPLER_3D) target = gl.TEXTURE_3D;
      if (target) {
        gl.uniform1i(loc, unit);
        samplers.push({ name, unit, target });
        unit++;
      }
    }
    return {
      prog,
      samplers,
      loc(name: string) {
        if (locs.has(name)) return locs.get(name)!;
        const l = gl.getUniformLocation(prog, name);
        locs.set(name, l);
        return l;
      },
    };
  }

  dispose() {
    for (const m of this.progs.values()) for (const p of m.values()) if (p) this.gl.deleteProgram(p.prog);
    for (const v of this.vsCache.values()) this.gl.deleteShader(v);
    this.progs.clear();
    this.vsCache.clear();
  }

  get size() {
    let n = 0;
    for (const m of this.progs.values()) n += m.size;
    return n;
  }
}

/** Pool of render targets keyed by size and format; textures are immutable (texStorage2D). */
export class TexturePool {
  private free = new Map<string, RT[]>();
  private live = new Set<RT>();
  frame = 0;
  created = 0;

  constructor(private gl: GL) {}

  acquire(w: number, h: number, fmt: number): RT {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    const key = `${w}x${h}:${fmt}`;
    const list = this.free.get(key);
    let rt = list?.pop();
    if (!rt) rt = this.create(w, h, fmt);
    rt.used = this.frame;
    this.live.add(rt);
    return rt;
  }

  release(rt: RT | null | undefined) {
    if (!rt || !this.live.has(rt)) return;
    this.live.delete(rt);
    const key = `${rt.w}x${rt.h}:${rt.fmt}`;
    let list = this.free.get(key);
    if (!list) this.free.set(key, (list = []));
    list.push(rt);
  }

  /** Releases everything still checked out (end-of-frame safety net). */
  releaseAll(except?: Set<RT>) {
    for (const rt of [...this.live]) if (!except?.has(rt)) this.release(rt);
  }

  /** Deletes free targets unused for `maxAge` frames. */
  trim(maxAge = 90) {
    for (const [key, list] of this.free) {
      const keep = list.filter((rt) => {
        if (this.frame - rt.used <= maxAge) return true;
        this.destroy(rt);
        return false;
      });
      if (keep.length) this.free.set(key, keep);
      else this.free.delete(key);
    }
  }

  private create(w: number, h: number, fmt: number): RT {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    this.created++;
    return { tex, fbo, w, h, fmt, used: this.frame };
  }

  private destroy(rt: RT) {
    this.gl.deleteTexture(rt.tex);
    this.gl.deleteFramebuffer(rt.fbo);
  }

  stats() {
    let free = 0;
    for (const l of this.free.values()) free += l.length;
    return { live: this.live.size, free, created: this.created };
  }

  dispose() {
    for (const list of this.free.values()) for (const rt of list) this.destroy(rt);
    for (const rt of this.live) this.destroy(rt);
    this.free.clear();
    this.live.clear();
  }
}

/** Tests whether a color-renderable format works here (some drivers lie). */
export function formatRenderable(gl: GL, fmt: number): boolean {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  try {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, 4, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
  } catch {
    return false;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
  }
}
