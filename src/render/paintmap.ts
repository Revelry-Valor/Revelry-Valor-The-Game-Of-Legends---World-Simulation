import { fbm, noise2 } from '../core/noise';
import { COVER_BRUSHES, type CoverBrush, type Surface } from '../core/paint';
import { evaluate, whirlpools, type Whirlpool } from '../core/terrain';
import { nearestPoint, RAIN_VERY_WET, RAIN_WET, sampleField, ZONE_INFO, type Climate } from '../core/climate';

/**
 * Draws a rectangle of the painted world as pixels, in the satellite (realistic) or paper
 * (drawn) look. Height is shown only by light and shade (REDESIGN.md, 1 and 8A).
 */

export type MapStyle = 'satellite' | 'paper';
/** What the map shows: the land itself, or one of the climate views. */
export type MapView = 'land' | 'zones' | 'temp' | 'rain' | 'pressure' | 'currents' | 'air';

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
  view: MapView;
  /** 1 = northern summer, −1 = northern winter. */
  season: number;
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
  lush: hex('#3f7a2c'),
  river: hex('#2d6a86'),
  lakeShallow: hex('#3f8fa0'),
  lakeDeep: hex('#1d4f6e'),
  basalt: hex('#4a4440'),
  ash: hex('#7c766e'),
  lava: hex('#2a2624'),
  glowHot: hex('#ffd36a'),
  glow: hex('#ff5a1a'),
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
  savanna: hex('#a09a52'),
  scrub: hex('#7d7f4a'),
  taiga: hex('#22382a'),
  steppe: hex('#a59a63'),
  rockdesert: hex('#a88f6e'),
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
  savanna: hex('#ddd29a'),
  scrub: hex('#c9c48f'),
  taiga: hex('#879a76'),
  steppe: hex('#e2d7a6'),
  rockdesert: hex('#dcc6a0'),
};

/** Render one picture. Returns RGBA bytes, transparent outside the map. */
export function renderPicture(surface: Surface, job: RenderJob, cl: Climate | null = null): Uint8ClampedArray {
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
  const se = cl ? (job.season > 0 ? cl.summer : cl.winter) : null;
  curClimate = cl && se ? { cl, se } : null;
  /** The nearest climate point, nudged by noise so zone edges look natural; land only if `onLand`. */
  const climatePoint = (x: number, y: number, onLand: boolean): number => {
    if (!cl) return -1;
    // Two scales of wobble: broad bends (so borders never run straight) and fine ragged edges.
    const big = Math.max(cl.step * 3, 60);
    const jx = x + big * fbm(x, y, big * 3, Math.max(px, big * 0.15), seed + 203, 3) + cl.step * 0.7 * fbm(x, y, cl.step * 1.4, Math.max(px, cl.step * 0.08), seed + 201, 4);
    const jy = y + big * fbm(x, y, big * 3, Math.max(px, big * 0.15), seed + 204, 3) + cl.step * 0.7 * fbm(x, y, cl.step * 1.4, Math.max(px, cl.step * 0.08), seed + 202, 4);
    let k = nearestPoint(cl, jx, jy);
    if (onLand && !cl.land[k]) {
      // Coast: borrow the nearest land point's climate.
      const k2 = nearestPoint(cl, x, y);
      k = cl.land[k2] ? k2 : -1;
      if (k < 0) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const k3 = nearestPoint(cl, x + dx * cl.step, y + dy * cl.step);
        if (cl.land[k3]) {
          k = k3;
          break;
        }
      }
    }
    return k;
  };

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
        sea = seaClimate(sea, v, f.reefPaint[k], x, y, px, seed, false);
        col = sea;
        if (land > 0) {
          let c: RGB;
          const ck = climatePoint(x, y, true);
          if (ck >= 0 && cl!.cover.main[ck] >= 0) c = climateCover(cl!, ck, x, y, px, seed, false);
          else {
            const dryness = 0.5 + 0.5 * fbm(x, y, 220, Math.max(px * 2, 12), seed + 51, 5);
            c = mix(SAT.grass, SAT.dry, smooth(0.35, 0.75, dryness));
            c = mix(c, SAT.dry, 0.15 * (fbm(x, y, 12, px, seed + 52, 4) + 1) / 2);
          }
          c = landCover(c, f, k, x, y, px, seed, false);
          // Winter snow (or lasting snow) where the climate says so.
          if (se && ck >= 0 && se.snow[ck] && !f.cover.glacier?.[k]) c = mix(c, SAT.snow, 0.82 * (0.85 + 0.15 * fbm(x, y, 3, px, seed + 59, 3)));
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
          if (f.ramp[k] > 0) c = mix(c, SAT.path, f.ramp[k] * 0.2 + f.track[k] * 0.45);
          // River banks and waterfall oases: lush green, even in desert.
          if (f.wet[k] > 0) c = mix(c, SAT.lush, f.wet[k] * 0.55 * (1 - f.face[k]));
          // Volcanoes: dark basalt with paler ash streaks; lava flows black and ropy.
          if (f.volcano[k] > 0) c = mix(c, mix(SAT.basalt, SAT.ash, 0.5 + 0.5 * fbm(x, y, 2, px, seed + 57, 4)), f.volcano[k] * 0.85);
          if (f.lava[k] > 0) c = mix(c, mix(SAT.lava, SAT.basalt, 0.4 * (fbm(x, y, 0.8, px, seed + 58, 4) + 1)), f.lava[k]);
          const fs = f.face[k] > 0 ? 1 + (f.faceShade[k] - 1) * f.face[k] : 1;
          const lit = (0.55 + 0.45 * bright) * fs * (1 - f.shadow[k] * 0.6);
          c = [c[0] * lit, c[1] * lit, c[2] * lit];
          // Fresh water lies flat: rivers and lakes are not shaded by the slopes.
          const wa = f.water[k];
          if (wa > 0) {
            const wc = f.waterKind[k] === 2 ? mix(SAT.lakeShallow, SAT.lakeDeep, smooth(0, 0.8, f.waterDepth[k])) : SAT.river;
            c = mix(c, wc, wa);
          }
          if (f.foam[k] > 0) c = mix(c, [236, 244, 246], f.foam[k] * (0.6 + 0.4 * (fbm(x, y, 0.15, px, seed + 59, 3) > 0 ? 1 : 0.5)));
          // Active lava glows (lit from within).
          const gl = f.lavaGlow[k];
          if (gl > 0) c = mix(c, mix(SAT.glow, SAT.glowHot, smooth(0.5, 1, gl)), Math.min(1, gl * 1.2));
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
        sea = seaClimate(sea, v, f.reefPaint[k], x, y, px, seed, true);
        col = sea;
        if (land > 0) {
          let c = mix(PAPER.land, PAPER.shade, 0.06 * (fbm(x, y, 40, px, seed + 60) + 1));
          const ck = climatePoint(x, y, true);
          if (ck >= 0 && cl!.cover.main[ck] >= 0) c = mix(c, climateCover(cl!, ck, x, y, px, seed, true), 0.75);
          c = landCover(c, f, k, x, y, px, seed, true);
          if (se && ck >= 0 && se.snow[ck]) c = mix(c, [250, 250, 248], 0.7);
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
          // Ramps: a dashed track.
          if (f.track[k] > 0.3 && Math.sin((x + y) / Math.max(px * 3, 0.3)) > 0) c = mix(c, PAPER.ink, f.track[k] * 0.6);
          if (f.wet[k] > 0) c = mix(c, COVER_PAPER.forest, f.wet[k] * 0.3);
          if (f.volcano[k] > 0) c = mix(c, PAPER.shade, f.volcano[k] * 0.35);
          if (f.lava[k] > 0) c = mix(c, PAPER.ink, f.lava[k] * (fbm(x, y, 0.6, px, seed + 58, 3) > 0 ? 0.75 : 0.5));
          if (f.lavaGlow[k] > 0) c = mix(c, [200, 70, 30], f.lavaGlow[k] * 0.6);
          // Rivers and lakes in blue ink.
          const wa = f.water[k];
          if (wa > 0) c = mix(c, f.waterKind[k] === 2 ? PAPER.sea : [70, 110, 140], wa);
          if (f.foam[k] > 0.3) c = mix(c, [250, 250, 245], f.foam[k] * 0.7);
          col = mix(sea, c, land);
        }
        // Inked coastline.
        const ink = 1 - smooth(0.6, 1.6, Math.abs(v - 1.5) / gv);
        col = mix(col, PAPER.ink, ink * 0.9);
      }

      for (const p of pools) col = whirl(col, p, x, y, job, paper);
      if (cl && se) {
        // Fog over cold upwelling coasts, as a soft haze.
        const fog = sampleField(cl, se.fog, x, y);
        if (fog > 0.02) {
          // Patchy banks of sea fog, not an even wash.
          const patch = smooth(-0.1, 0.45, fbm(x, y, 70, Math.max(px, 5), seed + 210, 4)) * (0.7 + 0.3 * fbm(x, y, 12, Math.max(px, 1.5), seed + 211, 3));
          col = mix(col, [226, 231, 234], Math.min(0.38, fog * 0.45) * patch);
        }
        if (job.view !== 'land') col = climateView(col, job.view, cl, se, x, y, land, bright, climatePoint, px, seed);
      }

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
    c = mix(c, coverTint(key, x, y, px, seed, paper), Math.min(1, buf[k]));
  }
  return c;
}

/** A single cover's colour with its texture, anchored to the world. */
function coverTint(key: CoverBrush, x: number, y: number, px: number, seed: number, paper: boolean): RGB {
  let tint = paper ? COVER_PAPER[key] : COVER_SAT[key];
  const tex = fbm(x, y, Math.max(px * 3, 0.05), px * 0.8, seed + 70, 3);
  switch (key) {
    case 'forest':
    case 'jungle':
    case 'taiga': {
      if (paper) {
        const dot = noise2(x / (px * 2.2), y / (px * 2.2), seed + 71);
        tint = mix(tint, PAPER.ink, dot > 0.45 ? 0.45 : 0);
      } else {
        const crowns = 0.78 + 0.3 * tex + 0.08 * fbm(x, y, 25, px, seed + 72);
        tint = [tint[0] * crowns, tint[1] * crowns, tint[2] * crowns];
      }
      break;
    }
    case 'savanna':
    case 'scrub': {
      // Scattered trees and shrubs: dark specks in the grass, part of the texture.
      const specks = noise2(x / Math.max(px * 1.6, 0.04), y / Math.max(px * 1.6, 0.04), seed + 77);
      const density = key === 'scrub' ? 0.35 : 0.5;
      if (specks > density) tint = mix(tint, paper ? PAPER.shade : hex('#4f5a2c'), paper ? 0.3 : 0.55);
      tint = mix(tint, [0, 0, 0], 0.05 * tex);
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
    case 'rockdesert': {
      const stones = fbm(x, y, Math.max(px * 2, 0.1), px * 0.8, seed + 78, 3);
      tint = mix(tint, paper ? PAPER.shade : hex('#6f5d48'), Math.max(0, stones) * 0.35);
      break;
    }
    default:
      tint = mix(tint, [0, 0, 0], 0.06 * tex);
  }
  return tint;
}

/** The ground cover the climate gives a point: its main cover, with the second in patches by its share. */
function climateCover(cl: Climate, k: number, x: number, y: number, px: number, seed: number, paper: boolean): RGB {
  const a = COVER_BRUSHES[cl.cover.main[k]];
  const ta = coverTint(a, x, y, px, seed, paper);
  const share = cl.cover.share[k];
  if (share <= 0.01) return ta;
  // Patches about 30–60 km across, with ragged edges; the threshold sets how much ground they take.
  const nz = fbm(x, y, 45, Math.max(px, 2), seed + 220, 4);
  const t = smooth(-0.12, 0.12, (share - 0.5) * 1.3 - nz);
  return t <= 0 ? ta : mix(ta, coverTint(COVER_BRUSHES[cl.cover.second[k]], x, y, px, seed, paper), t);
}


/** Sea ice and coral reefs on the sea. */
function seaClimate(sea: RGB, v: number, reefPaint: number, x: number, y: number, px: number, seed: number, paper: boolean): RGB {
  const c = curClimate;
  if (c) {
    const k = nearestPoint(c.cl, x + c.cl.step * 0.5 * fbm(x, y, c.cl.step, Math.max(px, 1), seed + 230, 3), y + c.cl.step * 0.5 * fbm(x, y, c.cl.step, Math.max(px, 1), seed + 231, 3));
    if (c.se.ice[k] && !c.cl.land[k]) {
      const floes = fbm(x, y, 8, px, seed + 232, 4);
      sea = mix(sea, paper ? [240, 244, 245] : hex('#e4ecf1'), 0.85);
      if (Math.abs(floes) < 0.05) sea = mix(sea, paper ? PAPER.sea : hex('#7fa3bb'), 0.5);
    }
    const reef = reefPaint === 1 || (reefPaint !== 2 && c.cl.reef[k] === 1);
    if (reef && v >= 0.45 && v < 1.48) {
      // A barrier band along the shelf's outer edge, fringing reefs hugging the coast.
      const band = Math.max(Math.exp(-(((v - 0.65) / 0.09) ** 2)), Math.exp(-(((v - 1.36) / 0.07) ** 2)));
      const tex = 0.5 + 0.5 * fbm(x, y, 1.5, px, seed + 233, 4);
      sea = mix(sea, paper ? hex('#9fd3c8') : hex('#5fd2c3'), band * (0.45 + 0.4 * tex));
    }
  } else if (reefPaint === 1 && v >= 0.45 && v < 1.48) {
    const band = Math.max(Math.exp(-(((v - 0.65) / 0.09) ** 2)), Math.exp(-(((v - 1.36) / 0.07) ** 2)));
    sea = mix(sea, paper ? hex('#9fd3c8') : hex('#5fd2c3'), band * 0.7);
  }
  return sea;
}
let curClimate: { cl: Climate; se: Climate['summer'] } | null = null;

const TEMP_F: [number, string][] = [[-20, '#2b3b8c'], [10, '#5c8fd6'], [32, '#c6def0'], [50, '#f0eec2'], [68, '#f5c06a'], [86, '#e0743a'], [104, '#a82a26']];
const tempColour = (f: number): RGB => {
  for (let n = 1; n < TEMP_F.length; n++) {
    if (f <= TEMP_F[n][0] || n === TEMP_F.length - 1) {
      const [t0, c0] = TEMP_F[n - 1];
      const [t1, c1] = TEMP_F[n];
      return mix(hex(c0), hex(c1), Math.max(0, Math.min(1, (f - t0) / (t1 - t0))));
    }
  }
  return hex(TEMP_F[0][1]);
};
const RAIN_RAMP: RGB[] = [hex('#d8bd86'), hex('#e6dca2'), hex('#9fcf86'), hex('#4fa66e'), hex('#2a7fae'), hex('#1d4f8f')];
const rainColour = (r: number): RGB => {
  // Dry below RAIN_WET, wet up to RAIN_VERY_WET, very wet above: a continuous heat map.
  const t = r < RAIN_WET ? (r / RAIN_WET) * 0.33 : r < RAIN_VERY_WET ? 0.33 + ((r - RAIN_WET) / (RAIN_VERY_WET - RAIN_WET)) * 0.34 : 0.67 + Math.min(1, (r - RAIN_VERY_WET) / RAIN_VERY_WET) * 0.33;
  const s = t * (RAIN_RAMP.length - 1);
  const i = Math.min(RAIN_RAMP.length - 2, Math.floor(s));
  return mix(RAIN_RAMP[i], RAIN_RAMP[i + 1], s - i);
};
export const TEMP_LEGEND = TEMP_F;
/** Temperature (°F) as the map's temperature colour. */
export const tempColourF = tempColour;
export const RAIN_LEGEND = RAIN_RAMP;

/** The climate map views, laid over the painted map. */
function climateView(col: RGB, view: MapView, cl: Climate, se: Climate['summer'], x: number, y: number, land: number, bright: number, climatePoint: (x: number, y: number, l: boolean) => number, px: number, seed: number): RGB {
  const shade = 0.75 + 0.25 * Math.min(1.3, bright);
  const grey = (c: RGB, t: number): RGB => mix(c, [128, 132, 136], t);
  switch (view) {
    case 'zones': {
      if (land < 0.5) return mix(grey(col, 0.5), [40, 60, 80], 0.3);
      const k = climatePoint(x, y, true);
      if (k < 0 || cl.zone[k] < 0) return col;
      const z = hex(ZONE_INFO[cl.zone[k]].colour);
      return [z[0] * shade, z[1] * shade, z[2] * shade];
    }
    case 'temp': {
      const t = sampleField(cl, se.temp, x, y) * 1.8 + 32;
      const c = tempColour(t);
      return land >= 0.5 ? [c[0] * shade, c[1] * shade, c[2] * shade] : mix(c, col, 0.45);
    }
    case 'rain': {
      if (land < 0.5) return mix(grey(col, 0.5), [40, 60, 80], 0.3);
      const c = rainColour(sampleField(cl, se.rain, x, y));
      return [c[0] * shade, c[1] * shade, c[2] * shade];
    }
    case 'pressure': {
      const p = sampleField(cl, se.pressure, x, y);
      const base = grey(col, land >= 0.5 ? 0.55 : 0.35);
      let c = p > 0 ? mix(base, [214, 120, 96], Math.min(0.6, p / 12)) : mix(base, [92, 120, 214], Math.min(0.6, -p / 10));
      // Fronts: a soft grey zone where the air masses meet.
      const fr = sampleField(cl, se.front, x, y);
      c = mix(c, [150, 150, 158], smooth(0.25, 0.6, fr) * 0.7);
      return c;
    }
    case 'air': {
      // How much moisture the air carries: deep teal where moist, pale where it has dried out.
      const m = Math.max(0, Math.min(1, sampleField(cl, se.moist, x, y)));
      const base = grey(col, land >= 0.5 ? 0.7 : 0.8);
      const c = mix(mix(base, [236, 226, 196], 0.35), [22, 128, 140], Math.pow(m, 0.8) * 0.85);
      return land >= 0.5 ? [c[0] * (0.8 + 0.2 * shade), c[1] * (0.8 + 0.2 * shade), c[2] * (0.8 + 0.2 * shade)] : mix(c, [40, 70, 110], 0.25);
    }
    case 'currents': {
      if (land >= 0.5) return grey(col, 0.6);
      // A gentle tint for warm or cold water; the current paths carry the strong colour.
      const base = grey(col, 0.25);
      const a = sampleField(cl, se.curAnomaly, x, y);
      let c = a > 0 ? mix(base, [196, 92, 74], Math.min(0.35, a / 12)) : mix(base, [74, 128, 200], Math.min(0.35, -a / 10));
      // Upwelling: cold, rich water as a fine teal stipple.
      const up = sampleField(cl, se.upwell, x, y);
      if (up > 0.08) {
        const dots = smooth(0.25, 0.45, fbm(x, y, Math.max(px * 3, 3), Math.max(px, 1), seed + 220, 2));
        c = mix(c, [96, 200, 196], Math.min(0.55, up * 0.7) * (0.35 + 0.65 * dots));
      }
      return c;
    }
  }
  return col;
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
