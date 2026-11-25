/**
 * Where a people can live, as ranges (the Library's habitat sliders): for temperature, rainfall
 * and altitude, a comfortable range (lo to hi) inside a survivable one (min to max).
 *
 * - Inside the comfortable range a place is easy and draws them.
 * - Between it and the survivable limits life is harder the further out (fewer births, more
 *   deaths), up to about half as easy at the limit.
 * - Past the survivable limits it is much harder still, and soon too harsh to live at all.
 *
 * Temperature is in °C (a place's coldest season against the low end, its hottest against the
 * high end); rainfall and altitude are positions on named scales. The altitude scale runs on past
 * the peaks to the three sky layers.
 */

export interface Range4 {
  min: number;
  lo: number;
  hi: number;
  max: number;
}
export interface Ranges {
  temp: Range4;
  rain: Range4;
  alt: Range4;
}
export type RangeKey = keyof Ranges;
export const RANGE_KEYS: RangeKey[] = ['temp', 'rain', 'alt'];

/** Rainfall: a rain index for each step of the scale (a season's rain). */
export const RAIN_STEPS = [0.02, 0.06, 0.12, 0.22, 0.35, 0.6, 0.9, 1.3, 2];
export const RAIN_NAMES = ['Desert', 'Arid', 'Dry', 'Seasonal', 'Moist', 'Wet', 'Very wet', 'Rainforest', 'Drenched'];
/** Altitude: height (km) for each step on the land; then the sky layers. */
export const ALT_KM = [0, 0.15, 0.65, 1.6, 2.9, 4.5];
export const ALT_NAMES = ['Sea level', 'Lowland', 'Foothills', 'Highlands', 'High mountains', 'Peaks', 'Sky layer 1', 'Sky layer 2', 'Sky layer 3'];
/** The altitude position of a sky layer (1–3). */
export const skyPos = (layer: number) => 5 + layer;

/** A value's position on a stepped scale (continuous between steps; past the ends by the last step's size). */
function posOn(steps: number[], v: number): number {
  if (v <= steps[0]) return 0;
  for (let i = 1; i < steps.length; i++) if (v <= steps[i]) return i - 1 + (v - steps[i - 1]) / (steps[i] - steps[i - 1]);
  const n = steps.length - 1;
  return n + (v - steps[n]) / (steps[n] - steps[n - 1]);
}
export const rainPos = (rain: number) => posOn(RAIN_STEPS, rain);
export const altPos = (km: number) => posOn(ALT_KM, km);
/** The value at a position on a stepped scale (the inverse). */
function valAt(steps: number[], pos: number): number {
  if (pos <= 0) return steps[0] + pos * (steps[1] - steps[0]);
  const n = steps.length - 1;
  if (pos >= n) return steps[n] + (pos - n) * (steps[n] - steps[n - 1]);
  const i = Math.floor(pos);
  return steps[i] + (pos - i) * (steps[i + 1] - steps[i]);
}
export const rainAt = (pos: number) => valAt(RAIN_STEPS, pos);
export const altKmAt = (pos: number) => valAt(ALT_KM, pos);

/** Each scale, for the sliders: its ends, step, the marks along it, and how a value reads. */
export const SCALES: Record<RangeKey, { label: string; min: number; max: number; step: number; marks: { at: number; label: string }[]; read(v: number): string }> = {
  temp: {
    label: 'Temperature',
    min: -50,
    max: 50,
    step: 1,
    marks: [-40, -20, 0, 20, 40].map((c) => ({ at: c, label: `${Math.round(c * 1.8 + 32)}°F` })),
    read: (c) => `${Math.round(c * 1.8 + 32)}°F (${Math.round(c)}°C)`,
  },
  rain: { label: 'Rainfall', min: 0, max: 8, step: 0.25, marks: RAIN_NAMES.map((n, i) => ({ at: i, label: n })), read: (v) => named(RAIN_NAMES, v) },
  alt: { label: 'Altitude', min: 0, max: 8, step: 0.25, marks: ALT_NAMES.map((n, i) => ({ at: i, label: n })), read: (v) => named(ALT_NAMES, v) },
};
function named(names: string[], v: number): string {
  const i = Math.round(v);
  return Math.abs(v - i) < 0.01 ? names[Math.max(0, Math.min(names.length - 1, i))] : `between ${names[Math.floor(v)] ?? names[0]} and ${names[Math.ceil(v)] ?? names[names.length - 1]}`;
}

/** A range read from saved data (null if missing), its points kept in order and on the scale. */
export function readRange(v: unknown, key: RangeKey): Range4 | null {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  if (!o) return null;
  const S = SCALES[key];
  const pts = (['min', 'lo', 'hi', 'max'] as const).map((k) => o[k]);
  if (!pts.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  const [a, b, c, d] = (pts as number[]).map((x) => Math.max(S.min, Math.min(S.max, x)));
  const lo = Math.max(a, b);
  const hi = Math.max(lo, c);
  return { min: a, lo, hi, max: Math.max(hi, d) };
}
export function readRanges(v: unknown): Partial<Ranges> {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out: Partial<Ranges> = {};
  for (const k of RANGE_KEYS) {
    const r = readRange(o[k], k);
    if (r) out[k] = r;
  }
  return out;
}

// ---- The older 1–5 tolerances (still read where no range is set) ----

/** Each tolerance's limit, by level 1–5. Hottest season's mean (°C). */
export const HEAT = [26, 30, 34, 38, 44];
/** Coldest season's mean (°C). */
export const COLD = [8, 0, -10, -20, -35];
/** The wetter season's rain index at least (dry country). */
export const DRY = [0.35, 0.22, 0.12, 0.06, 0.02];
/** The drier season's rain index at most (rain all year). */
export const WET = [0.35, 0.6, 0.9, 1.3, 2];
/** Height (km). */
export const ALT = [0.8, 1.6, 2.5, 3.5, 5];
/** A tolerance's limit at a level, between the levels too, and past 5 by the last step again (up to 7). */
export function limitAt(table: number[], level: number): number {
  const t = Math.max(1, Math.min(7, level || 3)) - 1;
  if (t >= 4) return table[4] + (table[4] - table[3]) * (t - 4);
  const i = Math.floor(t);
  return table[i] + (table[i + 1] - table[i]) * (t - i);
}
export interface Tolerances {
  heat: number;
  cold: number;
  wet: number;
  dry: number;
  altitude: number;
}
/** The tolerance level a value calls for on a table (continuous; 1 when it is easy). */
export function levelNeeded(table: number[], value: number, higherIsHarder: boolean): number {
  for (let l = 1; l <= 7; l += 0.05) {
    const lim = limitAt(table, l);
    if (higherIsHarder ? value <= lim : value >= lim) return l;
  }
  return 7;
}
/** Ranges from the older tolerances: survivable to the tolerance's limit, comfortable all the way (so a race nobody has redrawn lives as it did). */
export function fromTolerances(t: Tolerances): Ranges {
  const r = (min: number, max: number): Range4 => ({ min, lo: min, hi: max, max });
  return {
    temp: r(limitAt(COLD, t.cold), limitAt(HEAT, t.heat)),
    rain: r(rainPos(limitAt(DRY, t.dry)), rainPos(limitAt(WET, t.wet))),
    alt: r(0, altPos(limitAt(ALT, t.altitude))),
  };
}

/** How a level of tolerance (a trait's, or what a culture has adapted) moves a range's edges outward. */
export const LEVEL_STEP = { heat: 4, cold: 9, wet: 1, dry: 1, altitude: 1 };
export type TolKey = keyof typeof LEVEL_STEP;
/** Ranges moved outward by levels of tolerance gained (negative: inward). */
export function widen(base: Ranges, by: Partial<Record<TolKey, number>>): Ranges {
  const c = (r: Range4): Range4 => ({ ...r });
  const out = { temp: c(base.temp), rain: c(base.rain), alt: c(base.alt) };
  const up = (r: Range4, d: number) => {
    r.max += d;
    r.hi = Math.min(r.max, Math.max(r.lo, r.hi + d));
  };
  const down = (r: Range4, d: number) => {
    r.min -= d;
    r.lo = Math.max(r.min, Math.min(r.hi, r.lo - d));
  };
  up(out.temp, (by.heat ?? 0) * LEVEL_STEP.heat);
  down(out.temp, (by.cold ?? 0) * LEVEL_STEP.cold);
  up(out.rain, (by.wet ?? 0) * LEVEL_STEP.wet);
  down(out.rain, (by.dry ?? 0) * LEVEL_STEP.dry);
  up(out.alt, (by.altitude ?? 0) * LEVEL_STEP.altitude);
  return out;
}

/** How many levels of tolerance (LEVEL_STEP) a distance past a limit is (for cultures adapting). */
function beyondLevels(key: TolKey, beyond: number): number {
  // °C for heat and cold; rain index for wet and dry (about a scale step per level); km for altitude.
  if (key === 'heat' || key === 'cold') return beyond / LEVEL_STEP[key];
  if (key === 'altitude') return beyond / 1.0;
  return beyond / (key === 'dry' ? 0.08 : 0.3);
}

/** What a place offers (its seasons, rain and height). */
export interface Place {
  hot: number;
  cold: number;
  wetSeason: number;
  drySeason: number;
  heightKm: number;
  /** An altitude position instead of a height (a sky layer). */
  altPos?: number;
}
/** Past the survivable limits, this much further is as hard again: °C hotter, °C colder, rain index drier and wetter, km higher (and altitude steps lower). */
const BEYOND = { hot: 6, cold: 8, dry: 0.08, wet: 0.3, high: 0.7, low: 0.75 };

/**
 * How hard a place is on a people with these ranges: `past` (0 easy; the climate factor is
 * e^−past), which way it is hard, how far past the survivable limits (levels, for adapting), and
 * whether it is comfortable on every count.
 */
export function harshness(r: Ranges, p: Place): { past: number; harsh: string[]; comfortable: boolean; over: Record<TolKey, number> } {
  let past = 0;
  const harsh: string[] = [];
  let comfortable = true;
  const over: Record<TolKey, number> = { heat: 0, cold: 0, wet: 0, dry: 0, altitude: 0 };
  // One side of one range: how far outside the comfortable edge (on the slider's scale) and, past
  // the survivable limit, how far beyond it (in the scale's own units: °C, rain index, km).
  const side = (outside: number, band: number, beyond: number, step: number, what: string, key: TolKey | null) => {
    if (outside <= 0) return;
    comfortable = false;
    // Between the comfortable range and the limit: up to half as hard at the limit; past it, much harder.
    past += band > 0 ? 0.5 * Math.min(1, outside / band) : 0;
    if (beyond > 0) {
      past += beyond / step;
      if (key) over[key] = Math.max(over[key], beyondLevels(key, beyond));
    }
    if (beyond > 0 || outside / Math.max(band, 1e-9) > 0.5) harsh.push(what);
  };
  const wetPos = rainPos(p.wetSeason);
  const dryPos = rainPos(p.drySeason);
  const a = p.altPos ?? altPos(p.heightKm);
  const km = p.altPos !== undefined ? altKmAt(p.altPos) : p.heightKm;
  side(p.hot - r.temp.hi, r.temp.max - r.temp.hi, p.hot - r.temp.max, BEYOND.hot, 'too hot', 'heat');
  side(r.temp.lo - p.cold, r.temp.lo - r.temp.min, r.temp.min - p.cold, BEYOND.cold, 'too cold', 'cold');
  side(r.rain.lo - wetPos, r.rain.lo - r.rain.min, rainAt(r.rain.min) - p.wetSeason, BEYOND.dry, 'too dry', 'dry');
  side(dryPos - r.rain.hi, r.rain.max - r.rain.hi, p.drySeason - rainAt(r.rain.max), BEYOND.wet, 'too wet', 'wet');
  side(a - r.alt.hi, r.alt.max - r.alt.hi, km - altKmAt(r.alt.max), BEYOND.high, 'too high', 'altitude');
  side(r.alt.lo - a, r.alt.lo - r.alt.min, r.alt.min - a, BEYOND.low, 'too low', null);
  return { past, harsh, comfortable, over };
}
