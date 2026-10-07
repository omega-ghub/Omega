// Procedural swatches for the Effects browser: one small canvas illustration
// per category, varied per item (hue/offset from a hash of its type), drawn
// once and cached as a data URL. Calm, desaturated tones that sit quietly in
// the dark UI.

const W = 64;
const H = 40;
const cache = new Map<string, string>();

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%, ${a})`;

type Painter = (x: CanvasRenderingContext2D, r: number, hue: number) => void;

const PAINTERS: Record<string, Painter> = {
  'Blur & Sharpen': (x, r, hue) => {
    x.fillStyle = hsl(hue, 18, 14);
    x.fillRect(0, 0, W, H);
    for (let i = 0; i < 3; i++) {
      const cx = 14 + i * 18 + r * 6;
      const g = x.createRadialGradient(cx, 20, 0, cx, 20, 16 - i * 3);
      g.addColorStop(0, hsl(hue + i * 25, 30, 72, 0.9));
      g.addColorStop(1, hsl(hue + i * 25, 30, 40, 0));
      x.fillStyle = g;
      x.fillRect(0, 0, W, H);
    }
  },
  Color: (x, r, hue) => {
    const g = x.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, hsl(hue + i * 60, 42, 52));
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    const v = x.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, 'rgba(255,255,255,0.0)');
    v.addColorStop(0.55 + r * 0.2, 'rgba(128,128,128,0.35)');
    v.addColorStop(1, 'rgba(10,10,12,0.85)');
    x.fillStyle = v;
    x.fillRect(0, 0, W, H);
  },
  Stylize: (x, r, hue) => {
    x.fillStyle = hsl(hue, 16, 13);
    x.fillRect(0, 0, W, H);
    x.fillStyle = hsl(hue, 30, 70);
    const step = 6;
    for (let yy = 3; yy < H; yy += step)
      for (let xx = 3 + ((yy / step) % 2) * 3; xx < W; xx += step) {
        const d = 0.4 + 2.4 * (1 - Math.hypot(xx - W * (0.35 + r * 0.3), yy - H / 2) / 40);
        if (d <= 0.2) continue;
        x.beginPath();
        x.arc(xx, yy, Math.max(0.3, d), 0, Math.PI * 2);
        x.fill();
      }
  },
  Distort: (x, r, hue) => {
    x.fillStyle = hsl(hue, 18, 14);
    x.fillRect(0, 0, W, H);
    x.lineWidth = 1.4;
    for (let i = 0; i < 6; i++) {
      x.strokeStyle = hsl(hue + i * 6, 28, 45 + i * 5);
      x.beginPath();
      for (let xx = 0; xx <= W; xx += 2) {
        const yy = 6 + i * 6 + Math.sin(xx / 7 + i * 0.6 + r * 6) * 3;
        if (xx === 0) x.moveTo(xx, yy);
        else x.lineTo(xx, yy);
      }
      x.stroke();
    }
  },
  Keying: (x, r) => {
    for (let yy = 0; yy < H; yy += 8) for (let xx = 0; xx < W; xx += 8) {
      x.fillStyle = ((xx + yy) / 8) % 2 ? '#2a2a30' : '#1c1c21';
      x.fillRect(xx, yy, 8, 8);
    }
    const g = x.createLinearGradient(24 + r * 8, 0, 40 + r * 8, 0);
    g.addColorStop(0, 'rgba(46,140,80,0)');
    g.addColorStop(1, 'rgba(46,140,80,0.95)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(214,170,140,0.9)';
    x.beginPath();
    x.ellipse(28 + r * 8, 22, 7, 10, 0, 0, Math.PI * 2);
    x.fill();
  },
  Light: (x, r, hue) => {
    x.fillStyle = '#121216';
    x.fillRect(0, 0, W, H);
    const cx = 20 + r * 24;
    const g = x.createRadialGradient(cx, 16, 0, cx, 16, 34);
    g.addColorStop(0, hsl(30 + hue * 0.1, 80, 82, 0.95));
    g.addColorStop(0.25, hsl(22 + hue * 0.1, 70, 55, 0.55));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,240,220,0.35)';
    x.fillRect(0, 15.5, W, 1);
  },
  Film: (x, r) => {
    x.fillStyle = '#17161a';
    x.fillRect(0, 0, W, H);
    const g = x.createLinearGradient(0, 8, 0, 32);
    g.addColorStop(0, '#5f5246');
    g.addColorStop(1, '#2d2722');
    x.fillStyle = g;
    x.fillRect(4, 8, W - 8, 24);
    x.fillStyle = '#0d0d10';
    for (let xx = 3; xx < W; xx += 7) {
      x.fillRect(xx, 2, 4, 3);
      x.fillRect(xx, 35, 4, 3);
    }
    for (let i = 0; i < 70; i++) {
      const v = hash(`g${i}${r}`);
      x.fillStyle = `rgba(255,255,255,${0.05 + v * 0.1})`;
      x.fillRect(4 + hash(`x${i}`) * (W - 8), 8 + hash(`y${i}${r}`) * 24, 1, 1);
    }
  },
  Generate: (x, r, hue) => {
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, hsl(hue, 30, 22));
    g.addColorStop(1, hsl(hue + 50, 34, 48));
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(255,255,255,0.16)';
    x.lineWidth = 1;
    const s = 8 + Math.round(r * 4);
    for (let xx = 0.5; xx < W; xx += s) {
      x.beginPath();
      x.moveTo(xx, 0);
      x.lineTo(xx, H);
      x.stroke();
    }
    for (let yy = 0.5; yy < H; yy += s) {
      x.beginPath();
      x.moveTo(0, yy);
      x.lineTo(W, yy);
      x.stroke();
    }
  },
  // ---- transitions ----
  Dissolve: (x, r, hue) => {
    const g = x.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, hsl(hue, 26, 32));
    g.addColorStop(0.3 + r * 0.1, hsl(hue, 26, 32));
    g.addColorStop(0.7 + r * 0.1, hsl(hue + 140, 26, 52));
    g.addColorStop(1, hsl(hue + 140, 26, 52));
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  },
  Wipe: (x, r, hue) => {
    x.fillStyle = hsl(hue, 24, 30);
    x.fillRect(0, 0, W, H);
    x.fillStyle = hsl(hue + 140, 24, 52);
    x.beginPath();
    x.moveTo(26 + r * 10, 0);
    x.lineTo(W, 0);
    x.lineTo(W, H);
    x.lineTo(14 + r * 10, H);
    x.closePath();
    x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.5)';
    x.beginPath();
    x.moveTo(26 + r * 10, 0);
    x.lineTo(14 + r * 10, H);
    x.stroke();
  },
  Motion: (x, r, hue) => {
    x.fillStyle = hsl(hue, 24, 30);
    x.fillRect(0, 0, W, H);
    x.fillStyle = hsl(hue + 140, 24, 50);
    x.fillRect(30 + r * 6, 0, W, H);
    x.strokeStyle = 'rgba(255,255,255,0.55)';
    x.lineWidth = 1.5;
    for (const yy of [14, 26]) {
      x.beginPath();
      x.moveTo(8, yy);
      x.lineTo(22, yy);
      x.moveTo(18, yy - 4);
      x.lineTo(22, yy);
      x.lineTo(18, yy + 4);
      x.stroke();
    }
  },
  Stylized: (x, r, hue) => {
    x.fillStyle = hsl(hue, 22, 26);
    x.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) {
      const v = hash(`b${i}${r}`);
      x.fillStyle = i % 3 === 0 ? 'rgba(220,70,90,0.55)' : i % 3 === 1 ? 'rgba(70,200,210,0.5)' : hsl(hue + 140, 28, 55, 0.85);
      x.fillRect(v * W * 0.8, (i / 9) * H, 10 + hash(`w${i}`) * 26, 3 + hash(`h${i}`) * 4);
    }
  },
};

/** A data URL swatch for an effect/transition (cached). Returns '' when no canvas is available. */
export function swatchFor(category: string, type: string): string {
  const key = `${category}|${type}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');
    if (x) {
      const r = hash(type);
      const paint = PAINTERS[category] ?? PAINTERS.Generate;
      paint(x, r, 200 + r * 120);
      url = c.toDataURL('image/png');
    }
  } catch {
    url = '';
  }
  cache.set(key, url);
  return url;
}
