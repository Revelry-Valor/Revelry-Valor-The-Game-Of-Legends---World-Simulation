import type { Climate } from '../core/climate';
import { canopyGround, crownAt, giantTrees, giantVines, limbAt, limbLength, treeCities, VINE_END_NAMES, type Vine } from '../core/canopy';
import type { VineEnd } from '../core/paint';
import { formatDistance, kmToMiles } from '../core/units';
import { shapeOf } from '../core/underdark';
import type { World } from '../core/world';
import { choice, h } from './dom';
import type { InfoItem } from './info';
import type { MapOverlay } from './mapview';
import { paintShape } from './underdark';

/**
 * The Trees & vines tab and the canopy view (Phase 12 step 3): giant trees (trunks on the land,
 * crowns in the canopy), their limbs and tree-city sites, and giant vines between places and
 * layers. The canopy view shows only the crowns, limbs and cities over a hazy copy of the land;
 * other views show the trunks and the vines that reach them.
 */

export type ShownLayer = 'surface' | 'underdark' | 'canopy' | 'sky1' | 'sky2' | 'sky3';

export interface CanopyDeps {
  world(): World;
  climate(): Climate | null;
  /** The canopy is chosen under View (shown outside the tab too). */
  shownElsewhere(): boolean;
  /** Which layer the other views show now (when the canopy isn't shown). */
  shownLayer(): ShownLayer;
  setUsed(on: boolean): void;
}

export interface Canopy {
  panel: HTMLElement;
  overlay: MapOverlay;
  setActive(on: boolean): void;
  showing(): boolean;
  /** The layers new vines run between (the tab's choice). */
  vineEnds(): { from: VineEnd; to: VineEnd };
  invalidate(): void;
}

const CROWN = '#3d7a32';
const LIMB = '#6e5634';
const END_MARK: Record<VineEnd, string> = { surface: 'S', canopy: 'C', sky1: '1', sky2: '2', sky3: '3' };
const ENDS: { value: VineEnd; label: string }[] = [
  { value: 'surface', label: 'Surface' },
  { value: 'canopy', label: 'Canopy' },
  { value: 'sky1', label: 'Sky 1' },
  { value: 'sky2', label: 'Sky 2' },
  { value: 'sky3', label: 'Sky 3' },
];

export function createCanopy(d: CanopyDeps): Canopy {
  let active = false;
  let from: VineEnd = 'surface';
  let to: VineEnd = 'sky1';
  const cvs: HTMLCanvasElement[] = [];
  const showing = () => active || (d.shownElsewhere() && d.world().layers.canopy);
  /** Land on the surface, from the climate's grid (everywhere counts until it is worked out). */
  const land = (x: number, y: number): boolean => {
    const cl = d.climate();
    if (!cl) return true;
    let i = Math.round((x - cl.x0) / cl.step);
    const j = Math.round((y - cl.y0) / cl.step);
    if (cl.wrapKm) i = ((i % cl.w) + cl.w) % cl.w;
    return j >= 0 && j < cl.h && i >= 0 && i < cl.w && cl.land[j * cl.w + i] === 1;
  };
  const vines = () => giantVines(d.world().surface, land);
  const off = (i: number, like: HTMLCanvasElement): CanvasRenderingContext2D => {
    let cv = cvs[i];
    if (!cv) cv = cvs[i] = document.createElement('canvas');
    if (cv.width !== like.width || cv.height !== like.height) {
      cv.width = like.width;
      cv.height = like.height;
    }
    const g = cv.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, cv.width, cv.height);
    return g;
  };

  const drawVines = (g: CanvasRenderingContext2D, list: Vine[], at: (x: number, y: number, c: number) => [number, number], scale: number, copies: number[]) => {
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const v of list) {
      const p = v.stroke.pts;
      const w = Math.max(1.6, v.stroke.size * scale);
      for (const c of copies) {
        const trace = () => {
          g.beginPath();
          for (let i = 0; i < p.length; i += 2) {
            const [x, y] = at(p[i], p[i + 1], c);
            if (i) g.lineTo(x, y);
            else g.moveTo(x, y);
          }
        };
        trace();
        g.strokeStyle = v.problem ? '#c0392b' : '#1d3512';
        g.setLineDash(v.problem ? [6, 4] : []);
        g.lineWidth = w + 3;
        g.stroke();
        g.setLineDash([]);
        trace();
        g.strokeStyle = '#64a83a';
        g.lineWidth = w;
        g.stroke();
        // Leaves along it.
        g.fillStyle = '#8fd05a';
        let run = 0;
        let side = 1;
        for (let i = 2; i < p.length; i += 2) {
          const [ax, ay] = at(p[i - 2], p[i - 1], c);
          const [x, y] = at(p[i], p[i + 1], c);
          run += Math.hypot(x - ax, y - ay);
          if (run < 14) continue;
          run = 0;
          side = -side;
          const a = Math.atan2(y - ay, x - ax) + side * 0.9;
          g.beginPath();
          g.ellipse(x + Math.cos(a) * (w / 2 + 2), y + Math.sin(a) * (w / 2 + 2), 3, 1.5, a, 0, Math.PI * 2);
          g.fill();
        }
        // Its ends, marked with the layer each is on.
        for (const [k, end] of [[0, v.from], [p.length - 2, v.to]] as [number, VineEnd][]) {
          const [x, y] = at(p[k], p[k + 1], c);
          g.beginPath();
          g.arc(x, y, 6.5, 0, Math.PI * 2);
          g.fillStyle = '#2c5a1c';
          g.fill();
          g.strokeStyle = '#e8f3d8';
          g.lineWidth = 1.2;
          g.stroke();
          g.fillStyle = '#ffffff';
          g.font = 'bold 8px sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(END_MARK[end], x, y + 0.5);
        }
      }
    }
    g.restore();
  };

  // ---- The tab ----
  const body = h('div', {});
  const panel = h('section', { class: 'view-panel canopy-panel' }, h('h2', {}, 'Giant trees & vines'), body);
  const render = () => {
    const w = d.world();
    const trees = giantTrees(w.surface);
    const cities = treeCities(w.surface);
    const vl = vines();
    const ll = limbLength(w.surface);
    const lost = cities.filter((c) => !c.tree).length;
    const crowns = trees.map((t) => kmToMiles(t.crown * 2));
    body.replaceChildren(
      h('label', { class: 'field-row small' },
        h('input', { type: 'checkbox', checked: w.layers.canopy, onchange: (e: Event) => { d.setUsed((e.target as HTMLInputElement).checked); render(); } }),
        'This world has a canopy layer'),
      h('p', { class: 'muted small' }, 'A giant tree’s trunk stands on the land; its crown spreads in the canopy, between the surface and the lowest sky layer. Limbs reach out from the crowns, roads through the treetops and bridges where they touch another crown. Tree cities are sites marked on crowns and limbs. Nothing here changes the land below.'),
      h('h3', {}, 'Trees'),
      h('p', { class: 'small' }, trees.length
        ? `${trees.length} giant tree${trees.length === 1 ? '' : 's'}, crowns ${Math.round(Math.min(...crowns))}${crowns.length > 1 && Math.round(Math.max(...crowns)) !== Math.round(Math.min(...crowns)) ? `–${Math.round(Math.max(...crowns))}` : ''} miles across${ll ? `; ${formatDistance(ll)} of limbs` : ''}. ${cities.length ? `${cities.length} tree cit${cities.length === 1 ? 'y' : 'ies'}${lost ? ` (${lost} not on a crown or limb, marked red)` : ''}.` : 'No tree cities yet.'}`
        : 'None yet: plant one with the Giant tree brush.'),
      h('h3', {}, 'New vines run'),
      choice<VineEnd>('From', ENDS, from, (v) => { from = v; }),
      choice<VineEnd>('To', ENDS, to, (v) => { to = v; }),
      h('p', { class: 'muted small' }, 'Drag a vine from its start to its end. A surface end must be on land, a canopy end on a crown or limb, and a sky end on an island of that layer; a vine whose ends don’t hold is outlined red.'),
      h('h3', {}, 'Vines'),
      ...(vl.length
        ? vl.map((v, n) => h('p', { class: `small${v.problem ? ' warn' : ''}` }, `Vine ${n + 1}: ${VINE_END_NAMES[v.from]} to ${VINE_END_NAMES[v.to]}, ${formatDistance(v.length)}${v.problem ? ` (${v.problem})` : ''}.`))
        : [h('p', { class: 'small' }, 'None yet.')]),
      h('p', { class: 'muted small' }, 'While this tab is open the map shows the canopy and every vine (each end marked S, C, 1, 2 or 3 for its layer). Elsewhere the trunks show on the land, and each view shows the vines that reach it. Choose the canopy under View → Layers to see it from other tabs. The peoples climb, cross and build up here in the next step.'),
    );
  };

  // ---- The map layer ----
  const overlay: MapOverlay = {
    draw(g, at, scale, copies) {
      const w = d.world();
      const trees = giantTrees(w.surface);
      if (!showing()) {
        const shown = d.shownLayer();
        if (shown === 'underdark') return;
        g.save();
        if (shown === 'surface') {
          // Trunks on the land, the crowns above them faintly outlined.
          for (const t of trees) {
            for (const c of copies) {
              const [x, y] = at(t.x, t.y, c);
              if (w.layers.canopy) {
                g.setLineDash([4, 4]);
                g.strokeStyle = 'rgba(240,248,225,0.7)';
                g.lineWidth = 1.2;
                g.beginPath();
                g.arc(x, y, t.crown * scale, 0, Math.PI * 2);
                g.stroke();
                g.setLineDash([]);
              }
              g.beginPath();
              g.arc(x, y, Math.max(4, t.trunk * scale), 0, Math.PI * 2);
              g.fillStyle = '#6b4826';
              g.fill();
              g.strokeStyle = '#f3e6c8';
              g.lineWidth = 1.5;
              g.stroke();
            }
          }
        }
        g.restore();
        drawVines(g, vines().filter((v) => v.from === shown || v.to === shown), at, scale, copies);
        return;
      }
      const cv = g.canvas as HTMLCanvasElement;
      const tf = g.getTransform();
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = 'rgba(222,232,212,0.5)';
      g.fillRect(0, 0, cv.width, cv.height);
      // Crowns and limbs together, so they join where they meet.
      const ground = off(0, cv);
      ground.setTransform(tf);
      for (const st of w.surface.strokes) {
        if (st.brush === 'limb') paintShape(ground, st, LIMB, at, scale, copies);
      }
      ground.globalCompositeOperation = 'source-over';
      for (const t of trees) paintShape(ground, t.stroke, CROWN, at, scale, copies);
      ground.setTransform(1, 0, 0, 1, 0, 0);
      const dpr = Math.abs(tf.d) || 1;
      g.shadowColor = 'rgba(15,30,10,0.55)';
      g.shadowBlur = 10;
      g.shadowOffsetY = 8 * dpr;
      g.drawImage(ground.canvas, 0, 0);
      g.shadowColor = 'transparent';
      g.setTransform(tf);
      // Leafy light on each lobe, and the top of the trunk.
      for (const t of trees) {
        const dd = shapeOf(t.stroke).dabs;
        for (const c of copies) {
          for (let i = 0; i < dd.length; i += 3) {
            const [x, y] = at(dd[i], dd[i + 1], c);
            const r = Math.max(1, dd[i + 2] * scale);
            const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
            grad.addColorStop(0, 'rgba(160,215,110,0.55)');
            grad.addColorStop(1, 'rgba(40,90,30,0)');
            g.fillStyle = grad;
            g.beginPath();
            g.arc(x, y, r, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
      // Tree cities: a gold ring with a roof; red when on neither crown nor limb.
      for (const city of treeCities(w.surface)) {
        for (const c of copies) {
          const [x, y] = at(city.x, city.y, c);
          g.beginPath();
          g.arc(x, y, 6, 0, Math.PI * 2);
          g.fillStyle = city.tree ? '#f3d27a' : '#e05a4a';
          g.fill();
          g.strokeStyle = '#3a2a10';
          g.lineWidth = 1.3;
          g.stroke();
          g.beginPath();
          g.moveTo(x - 3.5, y + 1);
          g.lineTo(x, y - 3);
          g.lineTo(x + 3.5, y + 1);
          g.stroke();
        }
      }
      g.restore();
      drawVines(g, vines(), at, scale, copies);
    },
    describe(x, y) {
      const w = d.world();
      const items: InfoItem[] = [];
      const trees = giantTrees(w.surface);
      const pxKm = 4;
      const vine = vines().find((v) => {
        const sh = shapeOf(v.stroke);
        let best = Infinity;
        const p = v.stroke.pts;
        for (let i = 0; i < p.length; i += 2) best = Math.min(best, Math.hypot(p[i] - x, p[i + 1] - y));
        return best <= Math.max(sh.half, pxKm) * 2;
      });
      const shown: ShownLayer = showing() ? 'canopy' : d.shownLayer();
      if (vine && (shown === 'canopy' || vine.from === shown || vine.to === shown)) items.push({ label: 'Giant vine', value: `${VINE_END_NAMES[vine.from]} to ${VINE_END_NAMES[vine.to]}${vine.problem ? ` (${vine.problem})` : ''}` });
      if (showing()) {
        const t = crownAt(w.surface, x, y);
        const n = t ? trees.indexOf(t) + 1 : 0;
        const city = treeCities(w.surface).find((c) => Math.hypot(c.x - x, c.y - y) < 4);
        items.push({ label: 'Canopy', value: t ? `Crown of giant tree ${n} (${Math.round(kmToMiles(t.crown * 2))} miles across)` : limbAt(w.surface, x, y) ? 'A great limb' : canopyGround(w.surface, x, y) ? 'Treetops' : 'Open air above the land' });
        if (city) items.push({ label: 'Tree city', value: city.tree ? 'A site for a city in the treetops' : 'Not on a crown or limb' });
      } else if (shown === 'surface') {
        const t = trees.find((k) => Math.hypot(k.x - x, k.y - y) <= k.crown);
        if (t) items.push({ label: 'Giant tree', value: Math.hypot(t.x - x, t.y - y) <= Math.max(t.trunk, 2) ? `Its trunk, ${Math.round(kmToMiles(t.trunk * 2) * 10) / 10} miles across` : 'Under its crown' });
      }
      return items.length ? items : null;
    },
  };

  render();
  return {
    panel,
    overlay,
    setActive(on) {
      active = on;
      if (on) render();
    },
    showing,
    vineEnds: () => ({ from, to }),
    invalidate() {
      if (active) render();
    },
  };
}
