// GPU compositor. OWNED BY THE RENDERER PACKAGE.
//
// A WebGL2 scene-linear compositor for FrameGraphs. Every layer is decoded
// into a linear-light, premultiplied float texture (input transform), graded,
// run through its effect passes, cropped/masked/transformed into the frame and
// blended. The frame is converted to the sequence's display space with an
// output transform, dithered to 8 bit and presented.
//
//   source ──input──▶ linear ──grade──▶ ──effects──▶ ──place (crop, masks,
//   transform, opacity, blend)──▶ frame accumulator ──output transform──▶ canvas
//
// Color: see engine/color/transforms.ts (curves, gamuts, output transforms)
// and engine/color/grade.ts (grade pipeline). Blend modes: ./blend.ts.
// Geometry: ./geometry.ts. Everything between passes is premultiplied,
// scene-linear Rec.709, RGBA16F (RGBA32F on request, RGBA8 as a last resort),
// in GL texture convention (v = 0 at the bottom row).
//
// The renderer never throws from render(): bad media, failed uploads, shader
// compile errors and lost contexts skip the affected work for that frame.

import type { BlendMode, ColorGrade } from '../../state/types';
import type { FrameGraph, LayerNode, LayerSource, TransitionNode } from '../render/graph';
import type { FrameImage, FrameProvider } from '../render/frames';
import { frameSize } from '../render/frames';
import { rasterizeCaptions, rasterizeGradient, rasterizeShape, rasterizeSolid, rasterizeText } from '../render/text';
import { getEffect, getTransition, listEffects, listTransitions } from '../effects/registry';
import { GLSL_PRELUDE, GLSL_TRANSITION_PRELUDE, PARAM_GLSL_TYPE, type EffectDef, type ParamDef, type TransitionDef } from '../effects/types';
import { getLoadedLut, type ParsedLut } from '../color/lut';
import { bakeCurves, curvesAreIdentity, curvesKey } from '../color/curves';
import { LOG_BLACK, LOG_WHITE, gradeIsNeutral, hueRotationMatrix, logStage, logStageIsIdentity, whiteBalanceMatrix } from '../color/grade';
import { OUTPUT_CODE, gamutMatrix, graphicsCode, graphicsColorLinear, inputGamutMatrix, inputTransformDef, parseHexColor, toGlMat3, type Mat3, type OutputSpace } from '../color/transforms';
import { blendIndex } from './blend';
import { AFF_IDENTITY, affMul, axisScales, boundsOf, fitFrameInCanvas, layerQuad, layerToFrame, workingScale, type Affine } from './geometry';
import { ProgramCache, TexturePool, VS_FULL, VS_QUAD, formatRenderable, type GL, type Program, type RT } from './glcore';
import { CROSS_DISSOLVE_GLSL, FS_DOWNSAMPLE, FS_INPUT, FS_OUTPUT, FS_PLACE, MAX_MASKS, gradeFragment } from './shaders';

export interface RenderOptions {
  /** Before/after comparison in the viewer: 'split' draws ungraded pixels left of `position` (0..1). */
  compare?: { mode: 'off' | 'split' | 'bypass'; position: number };
  /** Show the qualifier matte of this clip instead of the image. */
  matteClipId?: string | null;
}

export interface PixelReadback {
  width: number;
  height: number;
  /** RGBA8, display-referred (what the viewer shows), top row first. */
  data: Uint8ClampedArray;
}

/** Optional construction settings (the one-argument constructor is the public contract). */
export interface RendererSettings {
  /** Intermediate precision: 'half' (RGBA16F, default), 'float' (RGBA32F, e.g. for export), 'auto' = half. */
  precision?: 'auto' | 'half' | 'float';
  /** Dither the 8-bit output (default true). */
  dither?: boolean;
}

export interface RendererInfo {
  backend: 'webgl2' | 'canvas2d' | 'none';
  format: 'RGBA32F' | 'RGBA16F' | 'RGBA8' | 'none';
  floatLinear: boolean;
  maxTextureSize: number;
  contextLost: boolean;
}

export interface RenderStats {
  frames: number;
  lastFrameMs: number;
  uploads: number;
  rasterizations: number;
  programs: number;
  pool: { live: number; free: number; created: number };
}

/** Output-px-per-layer-px threshold above which upscaling uses bicubic (Catmull-Rom). */
const BICUBIC_ABOVE = 1.25;
const MAX_NEST = 8;

type Raw = { tex: WebGLTexture; w: number; h: number; mips: boolean };
interface Slot extends Raw {
  key?: string;
  src?: unknown;
  time?: number;
  used: number;
}

interface Ctx {
  graph: FrameGraph;
  frames: FrameProvider;
  /** Target size in px. */
  fw: number;
  fh: number;
  /** Target px per sequence px. */
  sx: number;
  sy: number;
  bypass: boolean;
  matteClipId: string | null;
  space: OutputSpace;
  depth: number;
  matte: RT | null;
}

interface LayerImage {
  rt: RT;
  /** Layer size in layer px. */
  w: number;
  h: number;
  /** Layer px → frame (sequence) px. */
  m: Affine;
  matte: boolean;
}

interface LutGpu {
  lut: ParsedLut;
  tex: WebGLTexture;
  width: number;
  shaper: WebGLTexture | null;
  shaperWidth: number;
  used: number;
}

const isVideoEl = (x: unknown): x is HTMLVideoElement => typeof HTMLVideoElement !== 'undefined' && x instanceof HTMLVideoElement;
const isCanvasLike = (x: unknown) => (typeof HTMLCanvasElement !== 'undefined' && x instanceof HTMLCanvasElement) || (typeof OffscreenCanvas !== 'undefined' && x instanceof OffscreenCanvas);

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parsePoint(v: unknown, fallback: [number, number] = [0.5, 0.5]): [number, number] {
  if (typeof v === 'string') {
    const p = v.split(',').map((s) => Number(s.trim()));
    if (p.length === 2 && p.every(Number.isFinite)) return [p[0], p[1]];
  }
  return fallback;
}

let supportCache: boolean | null = null;

export class Renderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Counters for diagnostics and tests. */
  readonly stats: RenderStats = { frames: 0, lastFrameMs: 0, uploads: 0, rasterizations: 0, programs: 0, pool: { live: 0, free: 0, created: 0 } };

  private gl: GL | null = null;
  private ctx2d: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private settings: Required<RendererSettings>;
  private disposed = false;
  private lost = false;
  private fmt = 0;
  private fmtName: RendererInfo['format'] = 'none';
  private floatLinear = false;
  private hwBlend = true;
  private maxTex = 4096;
  private pool!: TexturePool;
  private programs!: ProgramCache;
  private vaoFull: WebGLVertexArrayObject | null = null;
  private vaoQuad: WebGLVertexArrayObject | null = null;
  private quadBuf: WebGLBuffer | null = null;
  private quadData = new Float32Array(16);
  private dummy2D: WebGLTexture | null = null;
  private dummy3D: WebGLTexture | null = null;
  private display: RT | null = null;
  private readTarget: RT | null = null;
  private hasFrame = false;
  private frameNo = 0;
  private mediaSlots = new Map<string, Slot>();
  private synthSlots = new Map<string, Slot>();
  private captionSlot: Slot | null = null;
  private curveTex = new Map<string, { tex: WebGLTexture; used: number }>();
  private lutGpu = new Map<string, LutGpu>();
  private warned = new Set<string>();
  private maskA = new Float32Array(MAX_MASKS * 4);
  private maskB = new Float32Array(MAX_MASKS * 4);
  private maskC = new Float32Array(MAX_MASKS * 4);
  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.forgetGLObjects();
  };
  private onRestored = () => {
    if (this.disposed) return;
    this.lost = false;
    this.initGL();
  };

  /** True when WebGL2 is available (the renderer falls back to Canvas 2D otherwise). */
  static isSupported(): boolean {
    if (supportCache !== null) return supportCache;
    try {
      const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      supportCache = !!c.getContext('webgl2');
    } catch {
      supportCache = false;
    }
    return supportCache;
  }

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, settings: RendererSettings = {}) {
    this.canvas = canvas;
    this.settings = { precision: settings.precision ?? 'auto', dither: settings.dither ?? true };
    let gl: GL | null = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance',
      }) as GL | null;
    } catch {
      gl = null;
    }
    if (gl) {
      this.gl = gl;
      (canvas as EventTarget).addEventListener('webglcontextlost', this.onLost as EventListener, false);
      (canvas as EventTarget).addEventListener('webglcontextrestored', this.onRestored as EventListener, false);
      this.initGL();
    } else {
      try {
        this.ctx2d = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      } catch {
        this.ctx2d = null;
      }
      console.warn('[renderer] WebGL2 is unavailable; using the reduced Canvas 2D fallback');
    }
  }

  /** Backend and precision in use. */
  get info(): RendererInfo {
    return {
      backend: this.gl ? 'webgl2' : this.ctx2d ? 'canvas2d' : 'none',
      format: this.fmtName,
      floatLinear: this.floatLinear,
      maxTextureSize: this.maxTex,
      contextLost: this.lost,
    };
  }

  /** Output size in device pixels (the graph is scaled to fit, aspect preserved). */
  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  render(graph: FrameGraph, frames: FrameProvider, opts: RenderOptions = {}): void {
    if (this.disposed) return;
    if (!this.gl) {
      this.render2d(graph, frames);
      return;
    }
    if (this.lost || this.gl.isContextLost()) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.frameNo++;
    this.pool.frame = this.frameNo;
    try {
      this.renderGL(graph, frames, opts);
    } catch (e) {
      this.warnOnce('render', `[renderer] frame failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.pool.releaseAll();
      if (this.frameNo % 30 === 0) this.evictCaches();
      const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      this.stats.frames++;
      this.stats.lastFrameMs = t1 - t0;
      this.stats.programs = this.programs.size;
      this.stats.pool = this.pool.stats();
    }
  }

  /** Downscaled readback of the last rendered frame (for scopes). */
  readPixels(maxWidth = 320): PixelReadback {
    const gl = this.gl;
    if (!gl) return this.readPixels2d(maxWidth);
    const src = this.display;
    if (this.lost || gl.isContextLost() || !src || !this.hasFrame) {
      const w = Math.max(1, Math.min(Math.round(maxWidth), this.canvas.width));
      const h = Math.max(1, Math.round((w / Math.max(1, this.canvas.width)) * this.canvas.height));
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    }
    const w = Math.max(1, Math.min(Math.round(maxWidth), src.w));
    const h = Math.max(1, Math.round((w / src.w) * src.h));
    let target = src;
    if (w !== src.w || h !== src.h) {
      if (!this.readTarget || this.readTarget.w !== w || this.readTarget.h !== h) {
        if (this.readTarget) this.deleteRT(this.readTarget);
        this.readTarget = this.createRT(w, h, gl.RGBA8);
      }
      target = this.readTarget;
      const p = this.prog(VS_FULL, FS_DOWNSAMPLE, 'downsample');
      if (p) {
        const fx = src.w / w;
        const fy = src.h / h;
        const taps = Math.min(8, Math.max(1, Math.ceil(Math.max(fx, fy) - 0.01)));
        this.drawFull(p, target, { u_src: src.tex }, () => {
          this.u2f(p, 'u_foot', 1 / w, 1 / h);
          this.u1i(p, 'u_taps', taps);
        });
      }
    }
    const buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = new Uint8ClampedArray(w * h * 4);
    const row = w * 4;
    for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    return { width: w, height: h, data: out };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    (this.canvas as EventTarget).removeEventListener('webglcontextlost', this.onLost as EventListener);
    (this.canvas as EventTarget).removeEventListener('webglcontextrestored', this.onRestored as EventListener);
    const gl = this.gl;
    if (gl && !gl.isContextLost()) {
      try {
        this.pool?.dispose();
        this.programs?.dispose();
        for (const s of [...this.mediaSlots.values(), ...this.synthSlots.values()]) gl.deleteTexture(s.tex);
        if (this.captionSlot) gl.deleteTexture(this.captionSlot.tex);
        for (const c of this.curveTex.values()) gl.deleteTexture(c.tex);
        for (const l of this.lutGpu.values()) {
          gl.deleteTexture(l.tex);
          if (l.shaper) gl.deleteTexture(l.shaper);
        }
        if (this.display) this.deleteRT(this.display);
        if (this.readTarget) this.deleteRT(this.readTarget);
        if (this.dummy2D) gl.deleteTexture(this.dummy2D);
        if (this.dummy3D) gl.deleteTexture(this.dummy3D);
        if (this.quadBuf) gl.deleteBuffer(this.quadBuf);
        if (this.vaoFull) gl.deleteVertexArray(this.vaoFull);
        if (this.vaoQuad) gl.deleteVertexArray(this.vaoQuad);
      } catch {
        /* ignore */
      }
    }
    this.forgetGLObjects();
  }

  /**
   * Compiles every registered effect and transition with the renderer's
   * template and returns the ones that fail (for the effects package's tests
   * and diagnostics). Never throws.
   */
  validateShaders(): { kind: 'effect' | 'transition'; type: string; error: string }[] {
    const out: { kind: 'effect' | 'transition'; type: string; error: string }[] = [];
    if (!this.gl || this.lost) return out;
    for (const def of listEffects()) {
      let passes = def.passes;
      try {
        if (def.expand) {
          const p: Record<string, number | boolean | string> = {};
          for (const d of def.params) p[d.key] = d.default;
          passes = [...def.passes, ...def.expand(p, { w: 256, h: 256 })];
        }
      } catch (e) {
        out.push({ kind: 'effect', type: def.type, error: `expand() threw: ${String(e)}` });
        continue;
      }
      for (const pass of passes) {
        const fs = effectFragment(def, pass.glsl);
        if (!this.prog(VS_FULL, fs, `effect ${def.type}`)) out.push({ kind: 'effect', type: def.type, error: this.programs.errorFor(fs) ?? 'link failed' });
      }
    }
    for (const def of listTransitions()) {
      const fs = transitionFragment(def.params, def.glsl);
      if (!this.prog(VS_FULL, fs, `transition ${def.type}`)) out.push({ kind: 'transition', type: def.type, error: this.programs.errorFor(fs) ?? 'link failed' });
    }
    return out;
  }

  // =========================================================================
  // GL setup
  // =========================================================================

  private initGL() {
    const gl = this.gl!;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const cbf = !!gl.getExtension('EXT_color_buffer_float');
    const cbhf = !!gl.getExtension('EXT_color_buffer_half_float');
    this.floatLinear = !!gl.getExtension('OES_texture_float_linear');
    const floatBlend = !!gl.getExtension('EXT_float_blend');
    const candidates: [number, RendererInfo['format']][] = [];
    if (this.settings.precision === 'float' && cbf && this.floatLinear) candidates.push([gl.RGBA32F, 'RGBA32F']);
    if (cbf || cbhf) candidates.push([gl.RGBA16F, 'RGBA16F']);
    if (cbf && this.floatLinear) candidates.push([gl.RGBA32F, 'RGBA32F']);
    candidates.push([gl.RGBA8, 'RGBA8']);
    for (const [f, name] of candidates) {
      if (formatRenderable(gl, f)) {
        this.fmt = f;
        this.fmtName = name;
        break;
      }
    }
    if (this.fmtName === 'RGBA8') console.warn('[renderer] float render targets unavailable: compositing in 8-bit (reduced quality)');
    this.hwBlend = this.fmtName !== 'RGBA32F' || floatBlend;
    this.pool = new TexturePool(gl);
    this.programs = new ProgramCache(gl);

    // fullscreen triangle
    this.vaoFull = gl.createVertexArray();
    gl.bindVertexArray(this.vaoFull);
    const fb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // dynamic quad: pos.xy uv.xy per vertex
    this.vaoQuad = gl.createVertexArray();
    gl.bindVertexArray(this.vaoQuad);
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.quadData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);

    this.dummy2D = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.dummy2D);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.dummy3D = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, this.dummy3D);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    this.hasFrame = false;
  }

  /** Drops references after a context loss (the objects are already gone). */
  private forgetGLObjects() {
    this.mediaSlots.clear();
    this.synthSlots.clear();
    this.captionSlot = null;
    this.curveTex.clear();
    this.lutGpu.clear();
    this.display = null;
    this.readTarget = null;
    this.hasFrame = false;
    this.vaoFull = this.vaoQuad = null;
    this.quadBuf = null;
    this.dummy2D = this.dummy3D = null;
    if (this.gl) {
      this.pool = new TexturePool(this.gl);
      this.programs = new ProgramCache(this.gl);
    }
  }

  private createRT(w: number, h: number, fmt: number): RT {
    const gl = this.gl!;
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
    return { tex, fbo, w, h, fmt, used: this.frameNo };
  }

  private deleteRT(rt: RT) {
    this.gl!.deleteTexture(rt.tex);
    this.gl!.deleteFramebuffer(rt.fbo);
  }

  private acquire(w: number, h: number): RT {
    return this.pool.acquire(Math.min(Math.max(1, Math.round(w)), this.maxTex), Math.min(Math.max(1, Math.round(h)), this.maxTex), this.fmt);
  }

  private release(rt: RT | null | undefined) {
    this.pool.release(rt);
  }

  private prog(vs: string, fs: string, label: string): Program | null {
    return this.programs.get(vs, fs, label);
  }

  private warnOnce(key: string, msg: string) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(msg);
  }

  // --- uniform helpers ---
  private u1f(p: Program, n: string, v: number) {
    const l = p.loc(n);
    if (l) this.gl!.uniform1f(l, v);
  }
  private u1i(p: Program, n: string, v: number) {
    const l = p.loc(n);
    if (l) this.gl!.uniform1i(l, v);
  }
  private u2f(p: Program, n: string, a: number, b: number) {
    const l = p.loc(n);
    if (l) this.gl!.uniform2f(l, a, b);
  }
  private u3f(p: Program, n: string, a: number, b: number, c: number) {
    const l = p.loc(n);
    if (l) this.gl!.uniform3f(l, a, b, c);
  }
  private u4f(p: Program, n: string, a: number, b: number, c: number, d: number) {
    const l = p.loc(n);
    if (l) this.gl!.uniform4f(l, a, b, c, d);
  }
  private uMat3(p: Program, n: string, m: Mat3) {
    const l = p.loc(n);
    if (l) this.gl!.uniformMatrix3fv(l, false, toGlMat3(m));
  }

  /** Binds every sampler of `p` (given textures by name, dummies otherwise). */
  private bindSamplers(p: Program, tex: Record<string, WebGLTexture | null | undefined>) {
    const gl = this.gl!;
    for (const s of p.samplers) {
      gl.activeTexture(gl.TEXTURE0 + s.unit);
      const t = tex[s.name];
      if (s.target === gl.TEXTURE_3D) {
        gl.bindTexture(gl.TEXTURE_3D, t ?? this.dummy3D);
        gl.bindTexture(gl.TEXTURE_2D, null);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, t ?? this.dummy2D);
        gl.bindTexture(gl.TEXTURE_3D, null);
      }
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Fullscreen pass into `target`. */
  private drawFull(p: Program, target: RT, tex: Record<string, WebGLTexture | null | undefined>, uniforms: () => void) {
    const gl = this.gl!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    gl.disable(gl.BLEND);
    gl.useProgram(p.prog);
    this.bindSamplers(p, tex);
    uniforms();
    gl.bindVertexArray(this.vaoFull);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private clearRT(rt: RT, r: number, g: number, b: number, a: number) {
    const gl = this.gl!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
    gl.viewport(0, 0, rt.w, rt.h);
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Copies a region (target px, top-left origin) of `src` into the same place in `dst`. */
  private copyRegion(src: RT, dst: RT, x0 = 0, y0 = 0, x1 = src.w, y1 = src.h) {
    const gl = this.gl!;
    const gy0 = src.h - y1;
    const gy1 = src.h - y0;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fbo);
    gl.blitFramebuffer(x0, gy0, x1, gy1, x0, gy0, x1, gy1, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  // =========================================================================
  // Frame
  // =========================================================================

  private renderGL(graph: FrameGraph, frames: FrameProvider, opts: RenderOptions) {
    const gl = this.gl!;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (!(graph.width > 0 && graph.height > 0) || !(cw > 0 && ch > 0)) return;
    const fr = fitFrameInCanvas(graph.width, graph.height, cw, ch);
    this.setDrawingBufferSpace(graph.colorSpace);
    const mode = opts.compare?.mode ?? 'off';
    const main = this.composite(graph, frames, fr.w, fr.h, { bypass: mode === 'bypass', matteClipId: opts.matteClipId ?? null, background: true }, 0);
    let before: RT | null = null;
    const split = mode === 'split' && !main.matte ? Math.min(Math.max(opts.compare?.position ?? 0.5, 0), 1) : -1;
    if (split >= 0) before = this.composite(graph, frames, fr.w, fr.h, { bypass: true, matteClipId: null, background: true }, 0).rt;

    if (!this.display || this.display.w !== fr.w || this.display.h !== fr.h) {
      if (this.display) this.deleteRT(this.display);
      this.display = this.createRT(fr.w, fr.h, gl.RGBA8);
    }
    const p = this.prog(VS_FULL, FS_OUTPUT, 'output');
    if (!p) return;
    const space = (OUTPUT_CODE[graph.colorSpace as OutputSpace] ?? 0) as number;
    this.drawFull(p, this.display, { u_a: (main.matte ?? main.rt).tex, u_b: (before ?? main.rt).tex }, () => {
      this.u1f(p, 'u_split', split);
      this.u1i(p, 'u_space', space);
      this.uMat3(p, 'u_toP3', gamutMatrix('rec709', 'p3d65'));
      this.u1i(p, 'u_passthrough', main.matte ? 1 : 0);
      this.u1f(p, 'u_dither', this.settings.dither ? 0.98 : 0);
    });

    // Present: letterbox bars, then the frame.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    if (fr.w !== cw || fr.h !== ch) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.display.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    const gy = ch - fr.y - fr.h;
    gl.blitFramebuffer(0, 0, fr.w, fr.h, fr.x, gy, fr.x + fr.w, gy + fr.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    this.hasFrame = true;
  }

  private setDrawingBufferSpace(cs: string) {
    const gl = this.gl as GL & { drawingBufferColorSpace?: PredefinedColorSpace };
    if (!('drawingBufferColorSpace' in gl)) return;
    const want: PredefinedColorSpace = cs === 'p3' ? 'display-p3' : 'srgb';
    try {
      if (gl.drawingBufferColorSpace !== want) gl.drawingBufferColorSpace = want;
    } catch {
      /* unsupported */
    }
  }

  /** Composites a graph into a linear premultiplied target of fw×fh. */
  private composite(graph: FrameGraph, frames: FrameProvider, fw: number, fh: number, o: { bypass: boolean; matteClipId: string | null; background: boolean }, depth: number): { rt: RT; matte: RT | null } {
    const space = (graph.colorSpace ?? 'rec709') as OutputSpace;
    const ctx: Ctx = { graph, frames, fw, fh, sx: fw / graph.width, sy: fh / graph.height, bypass: o.bypass, matteClipId: o.matteClipId, space, depth, matte: null };
    const accum = this.acquire(fw, fh);
    const bg = o.background ? graphicsColorLinear(space, graph.background, [0, 0, 0, 1]) : [0, 0, 0, 0];
    this.clearRT(accum, bg[0] * bg[3], bg[1] * bg[3], bg[2] * bg[3], bg[3]);
    for (const item of graph.items) {
      try {
        if (item.type === 'layer') this.drawLayer(item, accum, ctx);
        else this.drawTransition(item, accum, ctx);
      } catch (e) {
        const id = item.type === 'layer' ? item.clipId : item.trackId;
        this.warnOnce(`item-${id}`, `[renderer] skipped ${item.type} ${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (graph.captions?.length) {
      try {
        this.drawCaptions(graph, accum, ctx);
      } catch (e) {
        this.warnOnce('captions', `[renderer] captions skipped: ${String(e)}`);
      }
    }
    return { rt: accum, matte: ctx.matte };
  }

  private matteTarget(ctx: Ctx): RT {
    if (!ctx.matte) {
      ctx.matte = this.acquire(ctx.fw, ctx.fh);
      this.clearRT(ctx.matte, 0, 0, 0, 1);
    }
    return ctx.matte;
  }

  private drawLayer(layer: LayerNode, target: RT, ctx: Ctx) {
    if (layer.adjustment) {
      this.applyAdjustment(layer, target, ctx);
      return;
    }
    if (layer.opacity <= 0 && ctx.matteClipId !== layer.clipId) return;
    const img = this.processLayer(layer, ctx);
    if (!img) return;
    if (img.matte) this.place(img, layer, this.matteTarget(ctx), ctx, 'normal', 1, false);
    else this.place(img, layer, target, ctx, layer.blend, layer.opacity, false);
    this.release(img.rt);
  }

  // =========================================================================
  // Layer processing: source → linear → grade → effects
  // =========================================================================

  private processLayer(layer: LayerNode, ctx: Ctx): LayerImage | null {
    const src = layer.source;
    if (!src) return null;
    let w: number;
    let h: number;
    let raw: Raw | null = null;
    let code = 0;
    let gamut: Mat3 | null = null;
    switch (src.kind) {
      case 'media': {
        let img: FrameImage | null = null;
        try {
          img = ctx.frames.frame(src.assetId, src.sourceTime, layer.clipId);
        } catch (e) {
          this.warnOnce(`frame-${layer.clipId}`, `[renderer] frame provider failed for ${layer.clipId}: ${String(e)}`);
          return null;
        }
        if (!img) return null;
        if (isVideoEl(img) && img.readyState < 2) return null;
        let sz: { w: number; h: number };
        try {
          sz = frameSize(img);
        } catch {
          return null;
        }
        if (!(sz.w > 0 && sz.h > 0)) return null;
        w = sz.w;
        h = sz.h;
        raw = this.uploadMedia(layer.clipId, img, src.sourceTime, w, h);
        if (!raw) return null;
        const def = inputTransformDef(layer.inputTransform);
        code = def.code;
        gamut = def.gamut === 'rec709' ? null : inputGamutMatrix(def.id);
        break;
      }
      case 'text':
      case 'shape':
      case 'solid':
      case 'gradient':
        w = src.width;
        h = src.height;
        raw = this.uploadSynthetic(layer.clipId, src);
        if (!raw) return null;
        code = graphicsCode(ctx.space);
        break;
      case 'sequence':
        w = src.width;
        h = src.height;
        break;
      default:
        return null;
    }
    if (!(w > 0 && h > 0)) return null;
    const m = layerToFrame(layer.transform, w, h, ctx.graph.width, ctx.graph.height);
    const [ax, ay] = axisScales(m);
    const k = workingScale(Math.max(ax * ctx.sx, ay * ctx.sy), w, h, this.maxTex);
    const ww = Math.max(1, Math.round(w * k));
    const wh = Math.max(1, Math.round(h * k));
    let rt: RT;
    if (src.kind === 'sequence') {
      if (ctx.depth + 1 > MAX_NEST || !src.graph) return null;
      rt = this.composite(src.graph, ctx.frames, ww, wh, { bypass: ctx.bypass, matteClipId: null, background: false }, ctx.depth + 1).rt;
    } else {
      rt = this.acquire(ww, wh);
      this.inputPass(raw!, rt, code, gamut);
    }
    const matte = ctx.matteClipId === layer.clipId;
    rt = this.gradePass(rt, layer.grade, ctx, matte);
    if (!matte) rt = this.applyEffects(rt, layer, ww / w, ctx);
    return { rt, w, h, m, matte };
  }

  /** Raw upload → linear premultiplied, downscaled in linear light. */
  private inputPass(raw: Raw, out: RT, code: number, gamut: Mat3 | null) {
    const gl = this.gl!;
    const p = this.prog(VS_FULL, FS_INPUT, 'input');
    if (!p) return;
    const fx = raw.w / out.w;
    const fy = raw.h / out.h;
    const f = Math.max(fx, fy);
    const MAXT = 6;
    const taps = Math.min(MAXT, Math.max(1, Math.ceil(f - 0.01)));
    let lod = 0;
    if (f > MAXT) {
      gl.bindTexture(gl.TEXTURE_2D, raw.tex);
      if (!raw.mips) {
        gl.generateMipmap(gl.TEXTURE_2D);
        raw.mips = true;
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      lod = Math.log2(f / MAXT);
    } else if (raw.mips) {
      gl.bindTexture(gl.TEXTURE_2D, raw.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    this.drawFull(p, out, { u_raw: raw.tex }, () => {
      this.u1i(p, 'u_flip', 1);
      this.u1i(p, 'u_taps', taps);
      this.u2f(p, 'u_foot', 1 / out.w, 1 / out.h);
      this.u1f(p, 'u_lod', lod);
      this.u1i(p, 'u_code', code);
      this.u1i(p, 'u_useGamut', gamut ? 1 : 0);
      if (gamut) this.uMat3(p, 'u_gamut', gamut);
    });
  }

  // =========================================================================
  // Grade
  // =========================================================================

  private gradePass(rt: RT, grade: ColorGrade | null, ctx: Ctx, matte: boolean): RT {
    if (!grade && !matte) return rt;
    if (ctx.bypass && !matte) return rt;
    const g = grade;
    const lut = g && g.enabled && g.lut.id && g.lut.intensity !== 0 ? getLoadedLut(g.lut.id) : null;
    if (!matte && (!g || gradeIsNeutral(g, !!lut))) return rt;
    const on = !!g && g.enabled;
    const flags = {
      wb: on && !!(g!.temperature || g!.tint),
      log: on && !logStageIsIdentity(g!),
      curves: on && !curvesAreIdentity(g!.curves),
      qual: on && g!.qualifier.enabled,
      lut: (lut ? lut.kind : '') as '' | '1d' | '3d',
      shaper: !!(lut && lut.kind === '3d' && lut.shaper),
      matte,
    };
    const p = this.prog(VS_FULL, gradeFragment(flags), 'grade');
    if (!p) return rt;
    const tex: Record<string, WebGLTexture | null> = { u_src: rt.tex };
    if (flags.curves) tex.u_curves = this.curvesTexture(g!);
    let lg: LutGpu | null = null;
    if (lut) {
      lg = this.lutTexture(g!.lut.id!, lut);
      if (lg) {
        if (lut.kind === '3d') tex.u_lut3 = lg.tex;
        else tex.u_lut1 = lg.tex;
        if (lg.shaper) tex.u_shaper = lg.shaper;
      } else flags.lut = '';
    }
    const out = this.acquire(rt.w, rt.h);
    this.drawFull(p, out, tex, () => {
      this.u1f(p, 'u_exposure', on ? Math.pow(2, g!.exposure) : 1);
      if (flags.wb) this.uMat3(p, 'u_wb', whiteBalanceMatrix(g!.temperature, g!.tint));
      if (flags.log) {
        const s = logStage(g!);
        this.u1f(p, 'u_contrast', s.contrast);
        this.u1f(p, 'u_pivot', s.pivot);
        this.u1f(p, 'u_sat', s.saturation);
        this.u1f(p, 'u_vib', s.vibrance);
        this.u1f(p, 'u_hi', s.highlights);
        this.u1f(p, 'u_sh', s.shadows);
        this.u1f(p, 'u_logBlack', LOG_BLACK);
        this.u1f(p, 'u_logWhite', LOG_WHITE);
        this.u3f(p, 'u_lift', ...s.lift);
        this.u3f(p, 'u_gexp', ...s.gammaExp);
        this.u3f(p, 'u_gain', ...s.gain);
        this.u3f(p, 'u_offset', ...s.offset);
      }
      if (flags.qual) {
        const q = g!.qualifier;
        this.u4f(p, 'u_q0', q.hueCenter, q.hueWidth, q.softness, q.invert ? 1 : 0);
        this.u4f(p, 'u_q1', q.satLow, q.satHigh, q.lumLow, q.lumHigh);
        this.u2f(p, 'u_q2', Math.pow(2, q.exposure), q.saturation);
        this.uMat3(p, 'u_qHue', hueRotationMatrix(q.hueShift));
      }
      if (lut && lg && flags.lut) {
        this.u3f(p, 'u_lutMin', ...lut.domainMin);
        this.u3f(p, 'u_lutMax', ...lut.domainMax);
        this.u1i(p, 'u_lutSize', lut.size);
        this.u1i(p, 'u_lutW', lg.width);
        this.u1f(p, 'u_lutMix', g!.lut.intensity);
        if (lut.shaper && lg.shaper) {
          this.u3f(p, 'u_shMin', ...lut.shaper.domainMin);
          this.u3f(p, 'u_shMax', ...lut.shaper.domainMax);
          this.u1i(p, 'u_shSize', lut.shaper.size);
          this.u1i(p, 'u_shW', lg.shaperWidth);
        }
      }
    });
    this.release(rt);
    return out;
  }

  private curvesTexture(g: ColorGrade): WebGLTexture | null {
    const key = curvesKey(g.curves);
    const have = this.curveTex.get(key);
    if (have) {
      have.used = this.frameNo;
      return have.tex;
    }
    const gl = this.gl!;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1024, 1, 0, gl.RGBA, gl.FLOAT, bakeCurves(g.curves, 1024));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.curveTex.set(key, { tex, used: this.frameNo });
    return tex;
  }

  /** Uploads a 1D table as RGB32F rows of up to 4096 texels (texelFetch only). */
  private upload1D(data: Float32Array, size: number): { tex: WebGLTexture; width: number } {
    const gl = this.gl!;
    const width = Math.min(size, 4096, this.maxTex);
    const rows = Math.ceil(size / width);
    const buf = new Float32Array(width * rows * 3);
    buf.set(data.subarray(0, size * 3));
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, width, rows, 0, gl.RGB, gl.FLOAT, buf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return { tex, width };
  }

  private lutTexture(id: string, lut: ParsedLut): LutGpu | null {
    const have = this.lutGpu.get(id);
    if (have && have.lut === lut) {
      have.used = this.frameNo;
      return have;
    }
    const gl = this.gl!;
    if (have) {
      gl.deleteTexture(have.tex);
      if (have.shaper) gl.deleteTexture(have.shaper);
      this.lutGpu.delete(id);
    }
    try {
      let tex: WebGLTexture;
      let width = lut.size;
      if (lut.kind === '3d') {
        const N = lut.size;
        if (N > (gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number)) {
          this.warnOnce(`lut-size-${id}`, `[renderer] LUT ${id} (${N}³) exceeds the GPU 3D texture limit; skipped`);
          return null;
        }
        tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_3D, tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB32F, N, N, N, 0, gl.RGB, gl.FLOAT, lut.data);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      } else {
        const u = this.upload1D(lut.data, lut.size);
        tex = u.tex;
        width = u.width;
      }
      let shaper: WebGLTexture | null = null;
      let shaperWidth = 0;
      if (lut.shaper) {
        const u = this.upload1D(lut.shaper.data, lut.shaper.size);
        shaper = u.tex;
        shaperWidth = u.width;
      }
      const entry: LutGpu = { lut, tex, width, shaper, shaperWidth, used: this.frameNo };
      this.lutGpu.set(id, entry);
      return entry;
    } catch (e) {
      this.warnOnce(`lut-${id}`, `[renderer] LUT ${id} upload failed: ${String(e)}`);
      return null;
    }
  }

  // =========================================================================
  // Effects
  // =========================================================================

  private applyEffects(rt: RT, layer: LayerNode, k: number, ctx: Ctx): RT {
    for (const fx of layer.effects ?? []) {
      const def = getEffect(fx.type);
      if (!def) {
        this.warnOnce(`fx-unknown-${fx.type}`, `[renderer] unknown effect type "${fx.type}" skipped`);
        continue;
      }
      try {
        const out = this.runEffect(def, fx.params, rt, k, layer, ctx);
        if (out && out !== rt) {
          this.release(rt);
          rt = out;
        }
      } catch (e) {
        this.warnOnce(`fx-run-${fx.type}`, `[renderer] effect ${fx.type} failed: ${String(e)}`);
      }
    }
    return rt;
  }

  private runEffect(def: EffectDef, raw: Record<string, number | boolean | string>, src: RT, k: number, layer: LayerNode, ctx: Ctx): RT | null {
    const params: Record<string, number | boolean | string> = {};
    for (const p of def.params) {
      let v = raw[p.key] ?? p.default;
      if ((p.type === 'number' || p.type === 'angle') && p.unit === 'px') v = num(v, num(p.default)) * k;
      params[p.key] = v;
    }
    let passes = def.passes;
    if (def.expand) {
      try {
        passes = def.expand(params, { w: src.w, h: src.h });
      } catch (e) {
        this.warnOnce(`fx-expand-${def.type}`, `[renderer] ${def.type}.expand() threw; effect skipped: ${String(e)}`);
        return null;
      }
    }
    if (!passes?.length) return null;
    const progs: Program[] = [];
    for (const pass of passes) {
      const p = this.prog(VS_FULL, effectFragment(def, pass.glsl), `effect ${def.type}`);
      if (!p) return null;
      progs.push(p);
    }
    const orig = src;
    let cur = src;
    for (let i = 0; i < passes.length; i++) {
      const s = passes[i].scale && passes[i].scale! > 0 ? Math.min(passes[i].scale!, 4) : 1;
      const out = this.acquire(orig.w * s, orig.h * s);
      const p = progs[i];
      this.drawFull(p, out, { u_src: cur.tex, u_orig: orig.tex }, () => {
        this.u2f(p, 'u_resolution', orig.w, orig.h);
        this.u2f(p, 'u_texel', 1 / orig.w, 1 / orig.h);
        this.u1f(p, 'u_time', layer.local);
        this.u1f(p, 'u_seed', layer.seed);
        for (const d of def.params) this.setParam(p, d, params[d.key], ctx.space);
      });
      if (cur !== orig) this.release(cur);
      cur = out;
    }
    if (cur.w !== orig.w || cur.h !== orig.h) {
      // Last pass was scaled: bring it back to the layer's working size.
      const back = this.acquire(orig.w, orig.h);
      const cp = this.prog(VS_FULL, FS_DOWNSAMPLE, 'downsample');
      if (cp) {
        this.drawFull(cp, back, { u_src: cur.tex }, () => {
          this.u1i(cp, 'u_taps', 1);
          this.u2f(cp, 'u_foot', 0, 0);
        });
      }
      this.release(cur);
      cur = back;
    }
    return cur;
  }

  /** Sets u_<key> per PARAM_GLSL_TYPE. Colors: hex → linear RGB, straight alpha. Points: 'x,y'. */
  private setParam(p: Program, d: ParamDef, v: unknown, space: OutputSpace) {
    const l = p.loc(`u_${d.key}`);
    if (!l) return;
    const gl = this.gl!;
    switch (d.type) {
      case 'number':
      case 'angle':
        gl.uniform1f(l, num(v, num(d.default)));
        break;
      case 'bool':
        gl.uniform1f(l, v === true || v === 'true' || (typeof v === 'number' && v !== 0) ? 1 : 0);
        break;
      case 'choice':
        gl.uniform1i(l, Math.round(num(v, num(d.default))));
        break;
      case 'color': {
        const s = typeof v === 'string' && parseHexColor(v) ? v : String(d.default);
        const c = graphicsColorLinear(space, s, [0, 0, 0, 1]);
        gl.uniform4f(l, c[0], c[1], c[2], c[3]);
        break;
      }
      case 'point': {
        const pt = parsePoint(v, parsePoint(d.default));
        gl.uniform2f(l, pt[0], pt[1]);
        break;
      }
    }
  }

  // =========================================================================
  // Placement (crop, masks, transform, blend)
  // =========================================================================

  /**
   * Draws a processed layer into `target`. `adjust` composites an adjustment
   * layer's processed copy of the backdrop (lerp by coverage × opacity).
   */
  private place(img: LayerImage, layer: Pick<LayerNode, 'crop' | 'masks'> | null, target: RT, ctx: Ctx, blend: BlendMode, opacity: number, adjust: boolean) {
    const gl = this.gl!;
    const p = this.prog(VS_QUAD, FS_PLACE, 'place');
    if (!p) return;
    const fw = target.w;
    const fh = target.h;
    const mo = affMul([ctx.sx, 0, 0, ctx.sy, 0, 0], img.m);
    const [ax, ay] = axisScales(mo);
    const minScale = Math.max(Math.min(ax, ay), 1e-6);
    const pad = Math.min(2 / minScale, Math.max(img.w, img.h));
    const q = layerQuad(mo, img.w, img.h, pad);
    const bounds = boundsOf(q.pos, fw, fh);
    if (!bounds) return;
    const d = this.quadData;
    // TL, TR, BL, BR → triangle strip order TL, TR, BL, BR
    for (let i = 0; i < 4; i++) {
      d[i * 4] = (q.pos[i][0] / fw) * 2 - 1;
      d[i * 4 + 1] = 1 - (q.pos[i][1] / fh) * 2;
      d[i * 4 + 2] = q.uv[i][0];
      d[i * 4 + 3] = q.uv[i][1];
    }
    const mode = blendIndex(blend);
    const shaderBlend = adjust || !this.hwBlend || !(mode === 0 || mode === 1);
    let dst: RT | null = null;
    if (shaderBlend) {
      dst = this.acquire(fw, fh);
      this.copyRegion(target, dst, bounds.x0, bounds.y0, bounds.x1, bounds.y1);
    }
    // crop
    const c = layer?.crop;
    const cl = Math.min(Math.max(num(c?.left), 0), 1);
    const ct = Math.min(Math.max(num(c?.top), 0), 1);
    const cr = Math.min(Math.max(num(c?.right), 0), 1 - cl);
    const cb = Math.min(Math.max(num(c?.bottom), 0), 1 - ct);
    if (cl + cr >= 1 || ct + cb >= 1) {
      this.release(dst);
      return;
    }
    // masks
    const masks = (layer?.masks ?? []).filter((m) => m && m.enabled !== false).slice(0, MAX_MASKS);
    masks.forEach((m, i) => {
      const hw = Math.max((num(m.width) * img.w) / 2 + num(m.expansion), 0);
      const hh = Math.max((num(m.height) * img.h) / 2 + num(m.expansion), 0);
      const t = (num(m.rotation) * Math.PI) / 180;
      const r = Math.min(Math.max(num(m.roundness), 0) * Math.min(2 * hw, 2 * hh), Math.min(hw, hh));
      this.maskA.set([num(m.x, 0.5) * img.w, num(m.y, 0.5) * img.h, hw, hh], i * 4);
      this.maskB.set([Math.cos(t), Math.sin(t), r, Math.max(num(m.feather), 0)], i * 4);
      this.maskC.set([Math.min(Math.max(num(m.opacity, 1), 0), 1), m.invert ? 1 : 0, m.mode === 'subtract' ? 1 : m.mode === 'intersect' ? 2 : 0, m.shape === 'ellipse' ? 1 : 0], i * 4);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, fw, fh);
    gl.useProgram(p.prog);
    this.bindSamplers(p, { u_layer: img.rt.tex, u_dst: dst?.tex });
    const texelsPerPx = img.rt.w / img.w; // texels per layer px
    this.u2f(p, 'u_dstSize', fw, fh);
    this.u1i(p, 'u_mode', mode);
    this.u1i(p, 'u_shaderBlend', shaderBlend ? 1 : 0);
    this.u1i(p, 'u_adjust', adjust ? 1 : 0);
    this.u1f(p, 'u_opacity', Math.min(Math.max(opacity, 0), 1));
    this.u2f(p, 'u_layerPx', img.w, img.h);
    this.u2f(p, 'u_texSize', img.rt.w, img.rt.h);
    this.u1i(p, 'u_bicubic', minScale / texelsPerPx > BICUBIC_ABOVE ? 1 : 0);
    this.u4f(p, 'u_crop', cl, ct, cr, cb);
    this.u1f(p, 'u_cropFeather', Math.max(num(c?.feather), 0));
    this.u1i(p, 'u_maskCount', masks.length);
    if (masks.length) {
      const la = p.loc('u_mA');
      const lb = p.loc('u_mB');
      const lc = p.loc('u_mC');
      if (la) gl.uniform4fv(la, this.maskA);
      if (lb) gl.uniform4fv(lb, this.maskB);
      if (lc) gl.uniform4fv(lc, this.maskC);
    }
    if (shaderBlend) gl.disable(gl.BLEND);
    else {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      if (mode === 1) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.bindVertexArray(this.vaoQuad);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    this.release(dst);
  }

  /** Places a frame-sized texture (transition result, captions) over `target`. */
  private placeFrame(rt: RT, target: RT, ctx: Ctx, blend: BlendMode) {
    const img: LayerImage = { rt, w: ctx.graph.width, h: ctx.graph.height, m: AFF_IDENTITY, matte: false };
    this.place(img, null, target, ctx, blend, 1, false);
  }

  // =========================================================================
  // Adjustment layers, transitions, captions
  // =========================================================================

  private applyAdjustment(layer: LayerNode, target: RT, ctx: Ctx) {
    const matte = ctx.matteClipId === layer.clipId;
    const grades = matte || (!ctx.bypass && !!layer.grade && !gradeIsNeutral(layer.grade, !!(layer.grade.lut.id && getLoadedLut(layer.grade.lut.id))));
    if (!grades && !layer.effects?.length) return;
    if (layer.opacity <= 0 && !matte) return;
    let rt = this.acquire(target.w, target.h);
    this.copyRegion(target, rt);
    rt = this.gradePass(rt, layer.grade, ctx, matte);
    if (!matte) rt = this.applyEffects(rt, layer, ctx.sx, ctx);
    const img: LayerImage = { rt, w: ctx.graph.width, h: ctx.graph.height, m: AFF_IDENTITY, matte };
    if (matte) this.place(img, layer, this.matteTarget(ctx), ctx, 'normal', 1, false);
    else this.place(img, layer, target, ctx, layer.blend, layer.opacity, true);
    this.release(rt);
  }

  private drawTransition(node: TransitionNode, target: RT, ctx: Ctx) {
    const side = (l: LayerNode | null): RT | null => {
      if (!l) return null;
      if (l.adjustment) {
        const t = this.acquire(target.w, target.h);
        this.copyRegion(target, t);
        this.applyAdjustment(l, t, ctx);
        return t;
      }
      const img = this.processLayer(l, ctx);
      if (!img) return null;
      if (img.matte) {
        this.place(img, l, this.matteTarget(ctx), ctx, 'normal', 1, false);
        this.release(img.rt);
        return null;
      }
      const t = this.acquire(target.w, target.h);
      this.clearRT(t, 0, 0, 0, 0);
      this.place(img, l, t, ctx, 'normal', l.opacity, false);
      this.release(img.rt);
      return t;
    };
    const from = side(node.from);
    const to = side(node.to);
    if (!from && !to) return;
    const def = getTransition(node.transition);
    let p: Program | null = null;
    if (def) p = this.prog(VS_FULL, transitionFragment(def.params, def.glsl), `transition ${def.type}`);
    const params: ParamDef[] = p && def ? def.params : [];
    if (!p) p = this.prog(VS_FULL, transitionFragment([], CROSS_DISSOLVE_GLSL), 'crossDissolve');
    if (!p) return;
    const out = this.acquire(target.w, target.h);
    const prog = p;
    this.drawFull(prog, out, { u_from: from?.tex, u_to: to?.tex }, () => {
      this.u1f(prog, 'u_progress', Math.min(Math.max(num(node.progress), 0), 1));
      this.u2f(prog, 'u_resolution', target.w, target.h);
      this.u2f(prog, 'u_texel', 1 / target.w, 1 / target.h);
      for (const d of params) {
        let v: unknown = node.params?.[d.key];
        if (d.type === 'color' || d.type === 'point') v = typeof v === 'string' ? v : d.default;
        else if (v === undefined || !Number.isFinite(Number(v))) v = d.default;
        if ((d.type === 'number' || d.type === 'angle') && d.unit === 'px') v = num(v) * ctx.sx;
        this.setParam(prog, d, v, ctx.space);
      }
    });
    const blend: BlendMode = (node.to && !node.to.adjustment ? node.to.blend : node.from && !node.from.adjustment ? node.from.blend : 'normal') ?? 'normal';
    this.placeFrame(out, target, ctx, blend);
    this.release(out);
    this.release(from);
    this.release(to);
  }

  private drawCaptions(graph: FrameGraph, target: RT, ctx: Ctx) {
    const W = graph.width;
    const H = graph.height;
    const key = `${W}x${H}|${JSON.stringify(graph.captions.map((c) => [c.cue.text, c.cue.speaker ?? '', c.style, c.trackId]))}`;
    let slot = this.captionSlot;
    if (!slot || slot.key !== key) {
      const r = rasterizeCaptions(graph.captions, W, H);
      if (!r) return;
      slot = slot ?? this.newSlot();
      if (!this.upload(slot, r as unknown as TexImageSource, r.width, r.height)) return;
      slot.key = key;
      this.captionSlot = slot;
      this.stats.rasterizations++;
    }
    slot.used = this.frameNo;
    const rt = this.acquire(target.w, target.h);
    this.inputPass(slot, rt, graphicsCode(ctx.space), null);
    this.placeFrame(rt, target, ctx, 'normal');
    this.release(rt);
  }

  // =========================================================================
  // Sources
  // =========================================================================

  private newSlot(): Slot {
    const gl = this.gl!;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex, w: 0, h: 0, mips: false, used: this.frameNo };
  }

  /** Uploads any TexImageSource (never closes VideoFrames: the provider owns them). */
  private upload(slot: Slot, src: TexImageSource, w: number, h: number): boolean {
    const gl = this.gl!;
    try {
      gl.bindTexture(gl.TEXTURE_2D, slot.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      slot.w = w;
      slot.h = h;
      slot.mips = false;
      slot.used = this.frameNo;
      this.stats.uploads++;
      return true;
    } catch (e) {
      this.warnOnce(`upload-${String(e)}`, `[renderer] texture upload failed (layer skipped): ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  private uploadMedia(clipId: string, img: FrameImage, time: number, w: number, h: number): Raw | null {
    let slot = this.mediaSlots.get(clipId);
    // Immutable sources (VideoFrame, ImageBitmap, <img>) are re-uploaded only when they change.
    const mutable = isVideoEl(img) || isCanvasLike(img);
    if (slot && !mutable && slot.src === img && slot.time === time) {
      slot.used = this.frameNo;
      return slot;
    }
    if (!slot) {
      slot = this.newSlot();
      this.mediaSlots.set(clipId, slot);
    }
    if (!this.upload(slot, img as TexImageSource, w, h)) {
      slot.src = undefined;
      return null;
    }
    slot.src = img;
    slot.time = time;
    return slot;
  }

  private uploadSynthetic(clipId: string, src: Exclude<LayerSource, { kind: 'media' } | { kind: 'sequence' }>): Raw | null {
    const key = synthKey(src);
    let slot = this.synthSlots.get(clipId);
    if (slot && slot.key === key) {
      slot.used = this.frameNo;
      return slot;
    }
    let r: OffscreenCanvas | HTMLCanvasElement | null = null;
    try {
      switch (src.kind) {
        case 'text':
          r = rasterizeText(src);
          break;
        case 'shape':
          r = rasterizeShape(src);
          break;
        case 'solid':
          r = rasterizeSolid(src);
          break;
        case 'gradient':
          r = rasterizeGradient(src);
          break;
      }
    } catch (e) {
      this.warnOnce(`raster-${clipId}`, `[renderer] ${src.kind} rasterization failed for ${clipId}: ${String(e)}`);
      return null;
    }
    if (!r || !(r.width > 0 && r.height > 0)) return null;
    if (!slot) {
      slot = this.newSlot();
      this.synthSlots.set(clipId, slot);
    }
    if (!this.upload(slot, r as TexImageSource, r.width, r.height)) return null;
    slot.key = key;
    this.stats.rasterizations++;
    return slot;
  }

  private evictCaches() {
    const gl = this.gl!;
    const old = this.frameNo - 120;
    for (const [id, s] of this.mediaSlots)
      if (s.used < old) {
        gl.deleteTexture(s.tex);
        this.mediaSlots.delete(id);
      }
    for (const [id, s] of this.synthSlots)
      if (s.used < old) {
        gl.deleteTexture(s.tex);
        this.synthSlots.delete(id);
      }
    for (const [k, c] of this.curveTex)
      if (c.used < old) {
        gl.deleteTexture(c.tex);
        this.curveTex.delete(k);
      }
    for (const [k, l] of this.lutGpu)
      if (l.used < this.frameNo - 600 || getLoadedLut(k) !== l.lut) {
        gl.deleteTexture(l.tex);
        if (l.shaper) gl.deleteTexture(l.shaper);
        this.lutGpu.delete(k);
      }
    this.pool.trim(90);
  }

  // =========================================================================
  // Canvas 2D fallback (no WebGL2): media layers only, no grading.
  // =========================================================================

  private render2d(graph: FrameGraph, frames: FrameProvider) {
    const ctx = this.ctx2d;
    if (!ctx) return;
    const { width: cw, height: ch } = this.canvas;
    ctx.fillStyle = graph.background;
    ctx.fillRect(0, 0, cw, ch);
    const fr = fitFrameInCanvas(graph.width, graph.height, cw, ch);
    const s = fr.w / graph.width;
    for (const item of graph.items) {
      const layer = item.type === 'layer' ? item : (item.to ?? item.from);
      if (!layer?.source || layer.source.kind !== 'media') continue;
      try {
        const img = frames.frame(layer.source.assetId, layer.source.sourceTime, layer.clipId);
        if (!img) continue;
        const { w, h } = frameSize(img);
        if (!w || !h) continue;
        const m = affMul([s, 0, 0, s, fr.x, fr.y], layerToFrame(layer.transform, w, h, graph.width, graph.height));
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.globalAlpha = Math.min(Math.max(layer.opacity, 0), 1);
        ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
      } catch {
        /* skip */
      } finally {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
      }
    }
  }

  private readPixels2d(maxWidth: number): PixelReadback {
    const w = Math.max(1, Math.min(Math.round(maxWidth), this.canvas.width));
    const h = Math.max(1, Math.round((w / Math.max(1, this.canvas.width)) * this.canvas.height));
    try {
      const c = new OffscreenCanvas(w, h);
      const x = c.getContext('2d')!;
      x.drawImage(this.canvas as CanvasImageSource, 0, 0, w, h);
      return { width: w, height: h, data: x.getImageData(0, 0, w, h).data };
    } catch {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    }
  }
}

// ===========================================================================
// Shader templates (exactly as documented in engine/effects/types.ts)
// ===========================================================================

function paramUniforms(params: ParamDef[]): string {
  return params.map((p) => `uniform ${PARAM_GLSL_TYPE[p.type] ?? 'float'} u_${p.key};`).join('\n');
}

export function effectFragment(def: Pick<EffectDef, 'params'>, glsl: string): string {
  return `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform sampler2D u_orig;
uniform vec2  u_resolution;
uniform vec2  u_texel;
uniform float u_time;
uniform float u_seed;
${paramUniforms(def.params)}
in vec2 v_uv;
out vec4 outColor;
${GLSL_PRELUDE}
${glsl}
void main() { outColor = effect(v_uv); }
`;
}

export function transitionFragment(params: TransitionDef['params'], glsl: string): string {
  return `#version 300 es
precision highp float;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress;
uniform vec2 u_resolution;
uniform vec2 u_texel;
${paramUniforms(params)}
in vec2 v_uv;
out vec4 outColor;
${GLSL_TRANSITION_PRELUDE}
${glsl}
void main() { outColor = transition(v_uv); }
`;
}

/** Content key for synthetic sources: the raster only changes when this does. */
function synthKey(src: Exclude<LayerSource, { kind: 'media' } | { kind: 'sequence' }>): string {
  switch (src.kind) {
    case 'text': {
      const a = src.text.animation;
      const animating = (a && a.in !== 'none' && src.local < a.inDuration + 1e-6) || (a && a.out !== 'none' && src.local > src.duration - a.outDuration - 1e-6);
      return `text|${src.width}x${src.height}|${JSON.stringify(src.text)}|${animating ? src.local.toFixed(4) : 'static'}`;
    }
    case 'shape':
      return `shape|${src.width}x${src.height}|${JSON.stringify(src.shape)}`;
    case 'solid':
      return `solid|${src.width}x${src.height}|${src.color}`;
    case 'gradient':
      return `gradient|${src.width}x${src.height}|${JSON.stringify(src.gradient)}`;
  }
}
