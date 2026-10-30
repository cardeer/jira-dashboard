/**
 * Procedural planet surfaces, drawn once into a canvas and used as a CSS background.
 * Textures are 2:1 and wrap horizontally, so scrolling them sideways looks like the planet turning.
 */

export type PlanetKind = 'gas' | 'rocky' | 'terran' | 'lava';

const W = 256;
const H = 128;

type RGB = [number, number, number];

function hex(c: string): RGB {
  const n = parseInt(c.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function random(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Fractal value noise in 0–1 that wraps across the texture's width. */
function fbm(seed: number, octaves = 5, base = 4) {
  const rand = random(seed);
  const layers = Array.from({ length: octaves }, (_, o) => {
    const gw = base * 2 ** o;
    const gh = Math.max(2, Math.round(gw / 2)) + 1;
    return { gw, gh, grid: Float32Array.from({ length: gw * gh }, rand) };
  });
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (const { gw, gh, grid } of layers) {
      const fx = (x / W) * gw;
      const fy = (y / H) * (gh - 1);
      const x0 = Math.floor(fx);
      const y0 = Math.min(gh - 2, Math.floor(fy));
      const tx = smooth(fx - x0);
      const ty = smooth(fy - y0);
      const at = (gx: number, gy: number) => grid[gy * gw + (((gx % gw) + gw) % gw)];
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      sum += (top + (bottom - top) * ty) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const cache = new Map<string, string>();

/** A data URL for the planet's surface; the same inputs always give the same planet. */
export function planetTexture(kind: PlanetKind, light: string, dark: string, seedText: string): string {
  const key = `${kind}|${light}|${dark}|${seedText}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const seed = hashString(key);
  const lo = hex(dark);
  const hi = hex(light);
  const mid = mix(lo, hi, 0.5);
  const white: RGB = [245, 245, 250];
  const noise = fbm(seed);
  const detail = fbm(seed + 7, 4, 8);
  const clouds = fbm(seed + 13, 5, 3);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(W, H);

  for (let y = 0; y < H; y++) {
    const lat = y / H;
    for (let x = 0; x < W; x++) {
      const n = noise(x, y);
      let c: RGB;
      if (kind === 'gas') {
        // Wavy horizontal bands, bent by noise, with a darker belt or two.
        const v = lat * 9 + n * 2.2 + detail(x, y) * 0.6;
        const band = 0.5 + 0.5 * Math.sin(v * Math.PI);
        c = mix(mix(lo, mid, band), hi, Math.pow(band, 3) * 0.8);
      } else if (kind === 'rocky') {
        const t = n * 0.75 + detail(x, y) * 0.35;
        c = mix(lo, hi, (t - 0.25) * 1.6);
      } else if (kind === 'terran') {
        const land = n + (detail(x, y) - 0.5) * 0.15;
        c = land < 0.5 ? mix(lo, mid, land * 0.9) : mix(mid, hi, (land - 0.5) * 3);
        // Ice caps.
        if (Math.abs(lat - 0.5) > 0.42 - n * 0.06) c = mix(c, white, 0.85);
        const cl = clouds(x, y);
        if (cl > 0.55) c = mix(c, white, (cl - 0.55) * 3.2);
      } else {
        // Lava: dark crust split by glowing cracks.
        const crack = Math.abs(n - 0.5) + Math.abs(detail(x, y) - 0.5) * 0.35;
        const crust = mix([22, 8, 12], lo, detail(x, y) * 0.8);
        c = crack < 0.1 ? mix(hi, [255, 220, 150], 1 - crack / 0.1) : crust;
      }
      const i = (y * W + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  }

  // Craters on rocky worlds.
  ctx.putImageData(img, 0, 0);
  if (kind === 'rocky') {
    const rand = random(seed + 99);
    for (let k = 0; k < 18; k++) {
      const cx = rand() * W;
      const cy = 12 + rand() * (H - 24);
      const r = 2 + rand() * rand() * 12;
      for (const ox of [-W, 0, W]) {
        ctx.beginPath();
        ctx.arc(cx + ox, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgb(0 0 0 / 0.28)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + ox + r * 0.18, cy + r * 0.18, r * 0.8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgb(255 255 255 / 0.18)';
        ctx.lineWidth = Math.max(1, r * 0.2);
        ctx.stroke();
      }
    }
  }

  const url = canvas.toDataURL();
  cache.set(key, url);
  return url;
}
