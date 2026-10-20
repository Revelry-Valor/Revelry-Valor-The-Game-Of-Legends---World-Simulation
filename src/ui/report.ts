import type { Climate, FlowPath } from '../core/climate';
import type { Stroke } from '../core/paint';
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
      const majors = (se.currentPaths[0] ?? []).filter((p) => p.major);
      out.push(`  Major currents (${majors.length}):`);
      majors.forEach((p, i) => out.push(`   ${i + 1}. ${legs(p, at)}`));
      const minors = (se.currentPaths[0] ?? []).length - majors.length;
      if (minors) out.push(`  Plus ${minors} small currents in bays and shallows.`);
    }
  }

  // Currents drawn by hand: how the person says the currents should run.
  const sketches = world.surface.strokes.filter((st) => st.brush === 'current' && st.ctrl && st.ctrl.length >= 4);
  if (sketches.length) {
    out.push('');
    out.push(`Your drawn currents (teaching sketch, ${sketches.length}):`);
    sketches.forEach((st, i) => {
      const c = st.ctrl!;
      const pts: string[] = [];
      for (let q = 0; q < c.length; q += 2) pts.push(at(c[q], c[q + 1]));
      let len = 0;
      for (let q = 2; q < st.pts.length; q += 2) len += Math.hypot(st.pts[q] - st.pts[q - 2], st.pts[q + 1] - st.pts[q - 1]);
      out.push(`  ${i + 1}. ${st.current ?? 'warm'}: ${pts.join(' → ')} (${Math.round(len).toLocaleString('en-US')} km)`);
    });
  }

  // The painted world, compact: rounded, with dense paths thinned.
  const strokes = world.surface.strokes.map((st) => compactStroke(st));
  const data = JSON.stringify({ settings: s, surface: { strokes, nextId: world.surface.nextId } });
  out.push('');
  out.push('World data (for rebuilding this world):');
  out.push(await pack(data));
  return out.join('\n');
}

/** A current as legs of one kind: "warm 12°N 40°W → 38°N 60°W (2,900 km)". */
function legs(p: FlowPath, at: (x: number, y: number) => string): string {
  const name = (k: number) => (k > 0 ? 'warm' : k < 0 ? 'cold' : 'neutral');
  const parts: string[] = [];
  let start = 0;
  let len = 0;
  for (let q = 1; q <= p.kind.length; q++) {
    if (q < p.kind.length) len += Math.hypot(p.pts[q * 2] - p.pts[q * 2 - 2], p.pts[q * 2 + 1] - p.pts[q * 2 - 1]);
    if (q === p.kind.length || p.kind[q] !== p.kind[start]) {
      const e = q - 1;
      const mid = Math.floor((start + e) / 2);
      const via = len > 2500 && e - start > 4 ? ` via ${at(p.pts[mid * 2], p.pts[mid * 2 + 1])}` : '';
      parts.push(`${name(p.kind[start])} ${at(p.pts[start * 2], p.pts[start * 2 + 1])} → ${at(p.pts[e * 2], p.pts[e * 2 + 1])}${via} (${Math.round(len).toLocaleString('en-US')} km)`);
      start = q;
      len = 0;
    }
  }
  return parts.join('; ');
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
