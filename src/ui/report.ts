import type { Climate } from '../core/climate';
import { freshWaters, geoNames } from '../core/geography';
import { strokeSeason, type Stroke } from '../core/paint';
import { centreLatitude, kmPerDegree, latitudeAt, planetRadiusKm, southLatitude } from '../core/settings';
import { EARTH_RADIUS_KM, formatDistance, formatLatitude } from '../core/units';
import type { World } from '../core/world';

/**
 * A climate report to paste into a conversation: a readable summary (continents, the ITCZ and every
 * major current, in latitude and longitude) and a compact copy of the painted world, so the same
 * climate can be rebuilt and looked at elsewhere.
 */
export async function climateReport(world: World, cl: Climate | null): Promise<string> {
  const s = world.settings;
  const k = kmPerDegree(s);
  const W = s.widthKm;
  const lon = (x: number) => {
    const v = s.centreLongitude + (x - W / 2) / k;
    const w = ((((v + 180) % 360) + 360) % 360) - 180;
    return `${Math.abs(Math.round(w))}°${w > 0.5 ? 'E' : w < -0.5 ? 'W' : ''}`;
  };
  const lat = (y: number) => formatLatitude(Math.round(latitudeAt(s, y)));
  const at = (x: number, y: number) => `${lat(y)} ${lon(((x % W) + W) % W)}`;
  const out: string[] = [];
  out.push('REVELRY & VALOR CLIMATE REPORT v1');
  out.push(`World "${s.name}": ${formatDistance(s.widthKm)} × ${formatDistance(s.heightKm)}, ${formatLatitude(s.northLatitude)} to ${formatLatitude(southLatitude(s))}, middle ${formatLatitude(centreLatitude(s))} ${lon(W / 2)}. Edges: ${s.edges === 'wrap' ? 'wrap around' : 'lead nowhere'}.`);
  out.push(`Planet ${(planetRadiusKm(s) / EARTH_RADIUS_KM).toFixed(2)}× Earth's radius (degrees: ${s.degreeScale}), 1° = ${Math.round(k)} km. Tilt ${s.axialTilt}°, day ${s.dayLengthHours} h, spin ${s.rotation}, average ${s.averageTemperatureC} °C.`);

  if (cl) {
    // Continents: connected land on the climate grid.
    const seen = new Uint8Array(cl.w * cl.h);
    const lands: { n: number; x0: number; x1: number; y0: number; y1: number }[] = [];
    for (let k0 = 0; k0 < seen.length; k0++) {
      if (!cl.land[k0] || seen[k0]) continue;
      const stack = [k0];
      seen[k0] = 1;
      const b = { n: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      while (stack.length) {
        const q = stack.pop()!;
        b.n++;
        const i = q % cl.w;
        const j = (q / cl.w) | 0;
        b.x0 = Math.min(b.x0, i);
        b.x1 = Math.max(b.x1, i);
        b.y0 = Math.min(b.y0, j);
        b.y1 = Math.max(b.y1, j);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let ii = i + di;
          const jj = j + dj;
          if (jj < 0 || jj >= cl.h) continue;
          if (ii < 0 || ii >= cl.w) {
            if (!cl.wrapKm) continue;
            ii = (ii + cl.w) % cl.w;
          }
          const kk = jj * cl.w + ii;
          if (cl.land[kk] && !seen[kk]) {
            seen[kk] = 1;
            stack.push(kk);
          }
        }
      }
      lands.push(b);
    }
    lands.sort((a, b) => b.n - a.n);
    const cell = cl.step * cl.step;
    out.push('');
    out.push('Land masses (largest first):');
    lands
      .filter((b) => b.n * cell > 50000)
      .slice(0, 20)
      .forEach((b, i) => {
        const x = (c: number) => cl.x0 + c * cl.step;
        out.push(`  ${i + 1}. ${lat(x(b.y0))} to ${lat(x(b.y1))}, ${lon(x(b.x0))} to ${lon(x(b.x1))}, about ${Math.round((b.n * cell * 0.386102) / 1000).toLocaleString('en-US')} thousand sq mi`);
      });

    for (const [name, se] of [['Northern summer', cl.summer], ['Northern winter', cl.winter]] as const) {
      out.push('');
      out.push(`${name}:`);
      const cols = 12;
      const itcz: string[] = [];
      for (let c = 0; c < cols; c++) {
        const i = Math.min(cl.w - 1, Math.round(((c + 0.5) / cols) * cl.w));
        itcz.push(`${lon(cl.x0 + i * cl.step)} ${formatLatitude(Math.round(se.itcz[i]))}`);
      }
      out.push(`  ITCZ: ${itcz.join(', ')}`);
    }
  }

  // Geography: continents, islands, waters and natural regions, with their names.
  const geo = cl?.geo;
  if (cl && geo) {
    const names = geoNames(world.surface, cl);
    const size = (km2: number) => `${Math.round(km2 / 2589.988).toLocaleString('en-US')} thousand sq mi`;
    const nm = (kind: string, name?: string) => (name ? `${name} (${kind.toLowerCase()})` : `unnamed ${kind.toLowerCase()}`);
    out.push('');
    out.push('Geography:');
    for (const f of geo.landmasses.filter((q) => q.level === 'continent' || q.area > 50000).sort((a, b) => b.area - a.area)) out.push(`  ${nm(f.kind, names.land.get(f.id))} at ${at(f.x, f.y)}, ${size(f.area)}`);
    for (const f of geo.archipelagos) out.push(`  ${nm('Islands', names.archipelago.get(f.id))} at ${at(f.x, f.y)}`);
    for (const f of geo.waters.filter((q) => q.area > 20000).sort((a, b) => b.area - a.area)) out.push(`  ${nm(f.kind, names.water.get(f.id))} at ${at(f.x, f.y)}, ${size(f.area)}`);
    const kinds = new Map<string, number>();
    for (const r of geo.regions) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
    out.push(`  Natural regions: ${geo.regions.length} (${[...kinds].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')})`);
    for (const r of geo.regions) if (names.region.has(r.id) || r.kind === 'Mountains') out.push(`    ${nm(r.kind === 'Mountains' ? 'Mountain range' : r.kind, names.region.get(r.id))} at ${at(r.x, r.y)}`);
    const fresh = freshWaters(world.surface);
    for (const l of fresh.lakes) out.push(`  ${nm('Lake', names.lake.get(l.id))} at ${at(l.x, l.y)}`);
    for (const r of fresh.rivers) if (names.river.has(r.id)) out.push(`  ${nm('River', names.river.get(r.id))} from ${at(r.pts[0], r.pts[1])} to ${at(r.pts[r.pts.length - 2], r.pts[r.pts.length - 1])}`);
  }

  // The ocean currents, winds and highs, as placed by hand, with the season each holds in.
  const seasonName = (st: Stroke) => ({ both: 'both seasons', summer: 'northern summer', winter: 'northern winter' })[strokeSeason(st)];
  const course = (st: Stroke) => {
    const c = st.ctrl!;
    const pts: string[] = [];
    for (let q = 0; q < c.length; q += 2) pts.push(at(c[q], c[q + 1]));
    let len = 0;
    for (let q = 2; q < st.pts.length; q += 2) len += Math.hypot(st.pts[q] - st.pts[q - 2], st.pts[q + 1] - st.pts[q - 1]);
    return `${pts.join(' → ')} (${Math.round(len).toLocaleString('en-US')} km)`;
  };
  const currents = world.surface.strokes.filter((st) => st.brush === 'current' && st.ctrl && st.ctrl.length >= 4);
  if (currents.length) {
    out.push('');
    out.push(`Ocean currents (${currents.length}, placed by hand):`);
    currents.forEach((st, i) => out.push(`  ${i + 1}. ${st.current ?? 'warm'}${st.currentSize === 'secondary' ? ' (secondary)' : ''}, ${seasonName(st)}: ${course(st)}`));
  }
  const winds = world.surface.strokes.filter((st) => st.brush === 'wind' && st.ctrl && st.ctrl.length >= 4);
  if (winds.length) {
    out.push('');
    out.push(`Winds (${winds.length}, drawn by hand):`);
    winds.forEach((st, i) => out.push(`  ${i + 1}. ${Math.round(st.strength * 100)}%, ${seasonName(st)}: ${course(st)}`));
  }
  const highs = world.surface.strokes.filter((st) => st.brush === 'high' && st.pts.length >= 2);
  if (highs.length) {
    out.push('');
    out.push(`High-pressure zones (${highs.length}):`);
    highs.forEach((st, i) => out.push(`  ${i + 1}. ${at(st.pts[0], st.pts[1])}, ${Math.round(st.strength * 100)}%, reach ${formatDistance(st.size)}, ${seasonName(st)}`));
  }

  // The painted world, compact: rounded, with dense paths thinned.
  const strokes = world.surface.strokes.map((st) => compactStroke(st));
  const data = JSON.stringify({ settings: s, surface: { strokes, nextId: world.surface.nextId } });
  out.push('');
  out.push('World data (for rebuilding this world):');
  out.push(await pack(data));
  return out.join('\n');
}

function compactStroke(st: Stroke): Stroke {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const o: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(st)) o[key] = typeof v === 'number' ? r(v) : v;
  // Thin the path: keep points that bend it more than a small share of the brush size.
  const pts = st.pts;
  if (pts.length > 4) {
    const tol = Math.max(0.5, st.size * 0.04);
    const keep: number[] = [Math.round(pts[0]), Math.round(pts[1])];
    let lx = pts[0];
    let ly = pts[1];
    for (let q = 2; q < pts.length - 2; q += 2) if (Math.hypot(pts[q] - lx, pts[q + 1] - ly) >= tol) {
      keep.push(Math.round(pts[q]), Math.round(pts[q + 1]));
      lx = pts[q];
      ly = pts[q + 1];
    }
    keep.push(Math.round(pts[pts.length - 2]), Math.round(pts[pts.length - 1]));
    o.pts = keep;
  } else o.pts = pts.map((v) => Math.round(v * 10) / 10);
  if (st.ctrl) o.ctrl = st.ctrl.map((v) => Math.round(v));
  return o as unknown as Stroke;
}

/** Gzip and base64 where the browser can (much shorter to paste); plain JSON otherwise. */
async function pack(text: string): Promise<string> {
  try {
    const cs = new CompressionStream('gzip');
    const stream = new Blob([text]).stream().pipeThrough(cs);
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return `RVW1.gz:${btoa(bin)}`;
  } catch {
    return `RVW1.json:${text}`;
  }
}
