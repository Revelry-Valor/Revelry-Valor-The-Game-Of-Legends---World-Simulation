import { fbm, noise2 } from '../core/noise';
import { COVER_BRUSHES, type CoverBrush, type Surface } from '../core/paint';
import { evaluate, whirlpools, type Whirlpool } from '../core/terrain';

/**
 * Draws a rectangle of the painted world as pixels, in the satellite (realistic) or paper
 * (drawn) look. Height is shown only by light and shade (REDESIGN.md, 1 and 8A).
 */

export type MapStyle = 'satellite' | 'paper';

export interface RenderJob {
  /** Top-left corner of the picture in km, and km per pixel. */
  x0: number;
  y0: number;
  px: number;
  w: number;
  h: number;
  style: MapStyle;
  zones: boolean;
  seed: number;
  widthKm: number;
  heightKm: number;
  wrap: boolean;
}

type RGB = [number, number, number];
const hex = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const SAT = {
  deep: hex('#0c2a4a'),
  mid: hex('#174a74'),
  shelf: hex('#2a7e9b'),
  shore: hex('#56b3b6'),
  grass: hex('#5e7b3c'),
  dry: hex('#8d7d55'),
  foot: hex('#8b8a55'),
  high: hex('#9c8560'),
  rock: hex('#8d8478'),
  rockDark: hex('#5f574c'),
  snow: hex('#f1f4f7'),
  canyonFloor: hex('#b39a6a'),
  ejecta: hex('#cdbf9f'),
  path: hex('#c2a77a'),
  scree: hex('#a99f8e'),
  crack: hex('#33261d'),
  zone: [hex('#000000'), hex('#e3cf6b'), hex('#d68b37'), hex('#a8402a'), hex('#e9ecff')] as RGB[],
};
const COVER_SAT: Record<CoverBrush, RGB> = {
  forest: hex('#2c4a22'),
  jungle: hex('#1c4a1a'),
  grassland: hex('#8c9b4e'),
  tundra: hex('#8a8a72'),
  marsh: hex('#4d5b37'),
  dunes: hex('#dcb878'),
  badlands: hex('#b06842'),
  saltflats: hex('#ece6d6'),
  glacier: hex('#e6eff5'),
  beach: hex('#dcc99d'),
};
const PAPER = {
  sea: hex('#c4d5d2'),
  deep: hex('#a9c0c1'),
  land: hex('#ecdfbf'),
  ink: hex('#3f3122'),
  shade: hex('#8a6e4b'),
};
const COVER_PAPER: Record<CoverBrush, RGB> = {
  forest: hex('#97a36c'),
  jungle: hex('#7f9659'),
  grassland: hex('#d9d6a2'),
  tundra: hex('#cfcdb4'),
  marsh: hex('#b4bd98'),
  dunes: hex('#e6cd94'),
  badlands: hex('#d7aa82'),
  saltflats: hex('#f4efe2'),
  glacier: hex('#eef3f4'),
  beach: hex('#ead9a8'),
};

/** Render one picture. Returns RGBA bytes, transparent outside the map. */
export function renderPicture(surface: Surface, job: RenderJob): Uint8ClampedArray {
  const { w, h, px } = job;
  // One extra sample all round, for lighting and coastlines.
  const g = { x0: job.x0 + px / 2 - px, y0: job.y0 + px / 2 - px, px, w: w + 2, h: h + 2 };
  const f = evaluate(surface, g, { seed: job.seed, wrapKm: job.wrap ? job.widthKm : 0 });
  const out = new Uint8ClampedArray(w * h * 4);
  const W = g.w;
  // Vertical exaggeration for lighting: relief 1 is drawn like a high range.
  const E = 60;
  const L = [-0.62, -0.62, 0.48]; // light from the north-west
  const flat = L[2];
  const paper = job.style === 'paper';
  const x1 = job.x0 + w * px;
  const pools = whirlpools(surface).filter((p) => p.y + p.r > job.y0 && p.y - p.r < job.y0 + h * px && (job.wrap || (p.x + p.r > job.x0 && p.x - p.r < x1)));
  const seed = job.seed;

  for (let j = 0; j < h; j++) {
    const y = job.y0 + (j + 0.5) * px;
    for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 4;
      const x = job.x0 + (i + 0.5) * px;
      if (y < 0 || y > job.heightKm || x < 0 || x > job.widthKm) continue; // outside the map
      const k = (j + 1) * W + (i + 1);
      const v = f.ground[k];
      // Coast: an anti-aliased edge one pixel wide, from how fast the ground changes.
      const gvx = (f.ground[k + 1] - f.ground[k - 1]) / 2;
      const gvy = (f.ground[k + W] - f.ground[k - W]) / 2;
      const gv = Math.hypot(gvx, gvy) + 1e-6;
      const land = Math.max(0, Math.min(1, 0.5 + (v - 1.5) / gv));
      const r = f.relief;
      const dzx = ((r[k + 1] - r[k - 1]) / (2 * px)) * E;
      const dzy = ((r[k + W] - r[k - W]) / (2 * px)) * E;
      const nl = Math.hypot(dzx, dzy, 1);
      const bright = Math.max(0, (-dzx * L[0] - dzy * L[1] + L[2]) / nl) / flat;

      let col: RGB;
      if (!paper) {
        // Sea: deep to shallow, lighter toward the shore.
        const sv = Math.min(v, 1.5);
        let sea = sv < 0.5 ? mix(SAT.deep, SAT.mid, sv / 0.5) : sv < 1 ? mix(SAT.mid, SAT.shelf, (sv - 0.5) / 0.5) : mix(SAT.shelf, SAT.shore, smooth(1, 1.5, sv));
        sea = mix(sea, SAT.deep, 0.08 * (fbm(x, y, 300, Math.max(px * 2, 20), seed + 50, 4) + 1) * (1 - sv / 1.5));
        col = sea;
        if (land > 0) {
          const dryness = 0.5 + 0.5 * fbm(x, y, 220, Math.max(px * 2, 12), seed + 51, 5);
          let c = mix(SAT.grass, SAT.dry, smooth(0.35, 0.75, dryness));
          c = mix(c, SAT.dry, 0.15 * (fbm(x, y, 12, px, seed + 52, 4) + 1) / 2);
          c = landCover(c, f, k, x, y, px, seed, false);
          // Bare rock shows wherever the ground is steep.
          const steep = Math.min(1, Math.hypot(dzx, dzy) * 0.5);
          // Mountains are tinted by how high they are built, like an atlas: olive foothills,
          // tan and brown highlands, grey rock, then snow on the peaks.
          const m = f.mountain[k];
          if (m > 0.02) {
            const ramp = m < 0.22 ? mix(c, SAT.foot, smooth(0.02, 0.22, m) * 0.85) : m < 0.4 ? mix(mix(c, SAT.foot, 0.85), SAT.high, smooth(0.22, 0.4, m)) : mix(SAT.high, SAT.rock, smooth(0.4, 0.65, m));
            c = mix(ramp, SAT.rockDark, steep * 0.25 * smooth(0.1, 0.4, m));
            const snow = smooth(0.62, 0.85, m + 0.08 * fbm(x, y, 10, px, seed + 54, 4)) * (1 - steep * 0.3);
            c = mix(c, SAT.snow, snow);
          }
          else if (steep > 0.35) c = mix(c, SAT.rock, smooth(0.35, 0.9, steep) * 0.7);
          // Plateau tops: drier, stonier ground.
          if (f.plateau[k] > 0) c = mix(c, SAT.high, f.plateau[k] * 0.3);
          // Fresh crater ejecta: paler, dustier ground.
          if (f.ejecta[k] > 0) c = mix(c, SAT.ejecta, f.ejecta[k] * 0.55);
          // Canyon floors: sandy, a little green where water would run.
          if (f.canyon[k] > 0) c = mix(c, SAT.canyonFloor, smooth(0, 0.7, f.canyon[k]) * 0.75);
          if (f.scree[k] > 0) c = mix(c, mix(SAT.scree, SAT.rockDark, 0.3 * (fbm(x, y, 1.5, px, seed + 56, 3) + 1)), f.scree[k] * 0.8);
          // Rock faces show their layers.
          if (f.face[k] > 0) c = mix(c, strataColour(f.strata[k], false), f.face[k]);
          if (f.ravine[k] > 0) c = mix(c, SAT.crack, smooth(0.2, 0.8, f.ravine[k]) * 0.9);
          if (f.ramp[k] > 0) c = mix(c, SAT.path, f.ramp[k] * 0.2);
          const fs = f.face[k] > 0 ? 1 + (f.faceShade[k] - 1) * f.face[k] : 1;
          const lit = (0.55 + 0.45 * bright) * fs * (1 - f.shadow[k] * 0.6);
          c = [c[0] * lit, c[1] * lit, c[2] * lit];
          col = mix(sea, c, land);
        }
      } else {
        const sv = Math.min(v, 1.5);
        let sea = mix(PAPER.deep, PAPER.sea, smooth(0, 1.2, sv));
        // Ripple lines following the coast.
        if (sv > 0.2 && sv < 1.45) {
          const band = Math.abs(Math.sin(sv * Math.PI * 4));
          sea = mix(sea, PAPER.ink, (1 - smooth(0.0, 0.18, band)) * 0.25 * smooth(0.2, 0.6, sv));
        }
        col = sea;
        if (land > 0) {
          let c = mix(PAPER.land, PAPER.shade, 0.06 * (fbm(x, y, 40, px, seed + 60) + 1));
          c = landCover(c, f, k, x, y, px, seed, true);
          const shade = Math.max(0, Math.min(1.3, bright));
          c = mix(c, PAPER.shade, Math.max(0, 1 - shade) * 0.75);
          c = mix(c, [255, 250, 235], Math.max(0, shade - 1) * 0.6);
          // Mountains are inked: dark strokes on the shaded slopes, like a drawn map.
          const m = f.mountain[k];
          if (m > 0.03) c = mix(c, PAPER.ink, Math.max(0, Math.min(1, (0.9 - bright) * 1.3)) * 0.7 * smooth(0.03, 0.3, m));
          if (f.face[k] > 0) {
            // Rock faces in ink: hatched layers, darker where turned from the light.
            c = mix(c, strataColour(f.strata[k], true), f.face[k]);
            c = mix(c, PAPER.ink, f.face[k] * Math.max(0, Math.min(1, 1.1 - f.faceShade[k])) * 0.8);
          }
          if (f.shadow[k] > 0) c = mix(c, PAPER.shade, f.shadow[k] * 0.6);
          if (f.scree[k] > 0) c = mix(c, PAPER.shade, f.scree[k] * 0.3 * (fbm(x, y, 1.5, px, seed + 56, 3) > 0.1 ? 1 : 0.3));
          if (f.canyon[k] > 0) c = mix(c, PAPER.shade, smooth(0, 0.7, f.canyon[k]) * 0.3);
          if (f.ravine[k] > 0) c = mix(c, PAPER.ink, smooth(0.3, 0.8, f.ravine[k]) * 0.85);
          if (f.ejecta[k] > 0) c = mix(c, [250, 244, 226], f.ejecta[k] * 0.4);
          col = mix(sea, c, land);
        }
        // Inked coastline.
        const ink = 1 - smooth(0.6, 1.6, Math.abs(v - 1.5) / gv);
        col = mix(col, PAPER.ink, ink * 0.9);
      }

      for (const p of pools) col = whirl(col, p, x, y, job, paper);

      if (job.zones && f.zone[k] && land > 0.5) {
        const z = f.zone[k];
        col = mix(col, SAT.zone[z], 0.45);
        // Outline where the zone changes.
        if (f.zone[k + 1] !== z || f.zone[k + W] !== z || f.zone[k - 1] !== z || f.zone[k - W] !== z) col = mix(col, [30, 20, 10], 0.6);
      }
      out[o] = col[0];
      out[o + 1] = col[1];
      out[o + 2] = col[2];
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Rock layers on a face, from its height in layers: cream, tan, rust and grey-brown bands. */
const STRATA: RGB[] = [hex('#c9b089'), hex('#a8774f'), hex('#d8c3a0'), hex('#8e5f40'), hex('#b49a78'), hex('#7a6555')];
const STRATA_PAPER: RGB[] = [hex('#d9c69f'), hex('#b8996f'), hex('#e3d4b2'), hex('#a88a62')];
function strataColour(level: number, paper: boolean): RGB {
  const list = paper ? STRATA_PAPER : STRATA;
  const l = Math.max(0, level);
  const k = Math.floor(l);
  const fr = l - k;
  const a = list[k % list.length];
  const b = list[(k + 1) % list.length];
  // Sharp boundaries between layers, with a thin dark line where they meet.
  let c = mix(a, b, smooth(0.85, 1, fr));
  if (fr < 0.06) c = mix(c, [60, 45, 35], 0.35 * (1 - fr / 0.06));
  return c;
}

function landCover(c: RGB, f: ReturnType<typeof evaluate>, k: number, x: number, y: number, px: number, seed: number, paper: boolean): RGB {
  for (const key of COVER_BRUSHES) {
    const buf = f.cover[key];
    if (!buf || buf[k] <= 0.01) continue;
    const a = buf[k];
    let tint = paper ? COVER_PAPER[key] : COVER_SAT[key];
    // A little texture for each kind of ground, anchored to the world.
    const tex = fbm(x, y, Math.max(px * 3, 0.05), px * 0.8, seed + 70, 3);
    switch (key) {
      case 'forest':
      case 'jungle': {
        if (paper) {
          // Stippled trees.
          const dot = noise2(x / (px * 2.2), y / (px * 2.2), seed + 71);
          tint = mix(tint, PAPER.ink, dot > 0.45 ? 0.45 : 0);
        } else {
          const crowns = 0.78 + 0.3 * tex + 0.08 * fbm(x, y, 25, px, seed + 72);
          tint = [tint[0] * crowns, tint[1] * crowns, tint[2] * crowns];
        }
        break;
      }
      case 'marsh': {
        const pools = fbm(x, y, 3, px, seed + 73);
        if (pools > 0.25) tint = mix(tint, paper ? hex('#9fb7b4') : hex('#3c5b5d'), smooth(0.25, 0.35, pools));
        break;
      }
      case 'badlands': {
        const strata = Math.sin((y + 6 * fbm(x, y, 20, px, seed + 74)) / 1.6);
        tint = mix(tint, paper ? hex('#c99a74') : hex('#8f4b2f'), 0.35 + 0.3 * strata);
        break;
      }
      case 'saltflats': {
        const crack = Math.abs(noise2(x / 1.5, y / 1.5, seed + 75));
        if (crack < 0.06) tint = mix(tint, hex('#c9bfa8'), 0.6);
        break;
      }
      case 'glacier': {
        const crev = Math.abs(fbm(x, y, 4, px, seed + 76));
        tint = mix(tint, hex('#b7cfe0'), crev < 0.08 ? 0.5 : 0.12);
        break;
      }
      case 'grassland':
      case 'tundra':
      case 'dunes':
      case 'beach':
        tint = mix(tint, [0, 0, 0], 0.06 * tex);
        break;
    }
    c = mix(c, tint, Math.min(1, a));
  }
  return c;
}

function whirl(col: RGB, p: Whirlpool, x: number, y: number, job: RenderJob, paper: boolean): RGB {
  let dx = x - p.x;
  if (job.wrap) dx -= Math.round(dx / job.widthKm) * job.widthKm;
  const dy = y - p.y;
  const d = Math.hypot(dx, dy);
  if (d >= p.r) return col;
  const rr = d / p.r;
  const a = Math.atan2(dy, dx);
  const arms = Math.sin(a * 3 + Math.log(rr + 0.02) * 7);
  const foam = smooth(0.55, 0.95, arms) * (1 - rr) * p.strength;
  let c = mix(col, paper ? PAPER.ink : [235, 245, 245], foam * (paper ? 0.5 : 0.8));
  if (rr < 0.18) c = mix(c, paper ? PAPER.ink : [8, 22, 38], (1 - rr / 0.18) * (p.dangerous ? 0.85 : 0.4));
  return c;
}
