import type { Climate } from '../core/climate';
import { anchorOf, growRoots, leyLines, manaField, manaWord, naturalNodes, NODE_NAMES, polesOf, rootLines, rootStrokes, type ManaGrid, type ManaLine, type ManaNode } from '../core/mana';
import { brushDefaults, type Stroke } from '../core/paint';
import type { World } from '../core/world';
import { h, numberField } from './dom';
import type { InfoItem } from './info';
import type { MapOverlay } from './mapview';

/**
 * The Mana tab and map layer (Phase 11 step 1): the world tree's anchor and roots (placed, grown
 * and edited with the World tree brushes), and the mana heat map with its ley lines, roots and
 * nodes. While the peoples live, their temples, dawn cities and mage towers are nodes too.
 */

export type ManaDisplay = 'off' | 'lines' | 'heat';

/** The mana as it stands: its lines and nodes, and the field over the climate's grid. */
export interface ManaState {
  lines: ManaLine[];
  nodes: ManaNode[];
  anchor: { x: number; y: number } | null;
  grid: ManaGrid;
  field: Float32Array;
}

export interface ManaDeps {
  world(): World;
  climate(): Climate | null;
  redraw(): void;
  /** How mana shows on the map outside the Mana tab. */
  display(): ManaDisplay;
  /** The peoples' mana, when they are living (their nodes added); null otherwise. */
  live(): ManaState | null;
  /** Put these roots in place of all the roots (one undo step). */
  replaceRoots(roots: Stroke[]): void;
}

export interface Mana {
  panel: HTMLElement;
  overlay: MapOverlay;
  setActive(on: boolean): void;
  /** The map or the peoples changed: work the mana out again when next drawn. */
  invalidate(): void;
}

const NODE_COLOUR: Record<string, string> = { volcano: '#ff6a2a', whirlpool: '#3fb8d8', pole: '#e8f4ff', high: '#d67860', dawn: '#ffd24a', temple: '#f2e6c4', tower: '#b77cff', anchor: '#9be35a' };

export function createMana(d: ManaDeps): Mana {
  let active = false;
  let mains = 6;
  let state: ManaState | null = null;
  let stateKey: unknown[] = [];
  let heatImg: HTMLCanvasElement | null = null;

  /** The land's own mana (before the peoples), from the painting and the climate's grid. */
  const landState = (): ManaState | null => {
    const cl = d.climate();
    if (!cl) return null;
    const w = d.world();
    const wrapKm = cl.wrapKm;
    const nodes = naturalNodes(w.surface, polesOf(w.settings));
    const anchor = anchorOf(w.surface);
    const lines = [...leyLines(nodes, wrapKm), ...rootLines(w.surface, wrapKm)];
    const grid = { x0: cl.x0, y0: cl.y0, step: cl.step, w: cl.w, h: cl.h, wrapKm };
    return { lines, nodes, anchor, grid, field: manaField(grid, lines, nodes, anchor) };
  };
  const current = (): ManaState | null => {
    const live = d.live();
    const key = [live?.field, d.world().surface.strokes, d.climate()];
    if (state && key.every((v, i) => v === stateKey[i])) return state;
    state = live ?? landState();
    stateKey = key;
    heatImg = null;
    return state;
  };
  const heatImage = (st: ManaState): HTMLCanvasElement => {
    if (heatImg) return heatImg;
    const { w, h } = st.grid;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(w, h);
    // Thin (clear) through violet and magenta to gold where it is most dense.
    const ramp = [[90, 40, 160], [170, 60, 200], [235, 90, 170], [255, 200, 90]];
    for (let k = 0; k < w * h; k++) {
      const v = st.field[k];
      if (v < 0.04) continue;
      const s = Math.min(0.999, v) * (ramp.length - 1);
      const i = Math.floor(s);
      const t = s - i;
      const c = ramp[i].map((x, q) => x + (ramp[i + 1][q] - x) * t);
      img.data.set([c[0], c[1], c[2], Math.round(40 + 150 * v)], k * 4);
    }
    g.putImageData(img, 0, 0);
    heatImg = cv;
    return cv;
  };

  // ---- The tab ----
  const body = h('div', {});
  const panel = h('section', { class: 'view-panel mana-panel' }, h('h2', {}, 'Mana'), body);
  const render = () => {
    const w = d.world();
    const anchor = anchorOf(w.surface);
    const roots = w.surface.strokes.filter((s) => s.brush === 'root' && !s.erase);
    const st = current();
    const kinds = new Map<string, number>();
    for (const nd of st?.nodes ?? []) kinds.set(nd.kind, (kinds.get(nd.kind) ?? 0) + 1);
    body.replaceChildren(
      h('p', { class: 'muted small' }, 'Mana flows along ley lines between nodes (volcanoes, whirlpools, the poles on a globe, high-pressure zones, and as peoples build them dawn cities, temples and mage towers) and along the world tree’s roots. Where lines meet, cross or run together it is strongest. Place the tree’s anchor and grow its roots, or draw them yourself with the Root brush; every root can be moved, changed or deleted (Adjust, or erase).'),
      h('h3', {}, 'World tree'),
      h('p', { class: 'small' }, anchor ? `Anchor placed; ${roots.length} root${roots.length === 1 ? '' : 's'} (${roots.filter((r) => r.rootSize === 'sprout').length} sprouts).` : 'No anchor yet: pick Tree anchor above and click where the roots enter the world.'),
      numberField({ label: 'Main roots', value: mains, min: 2, max: 12, step: 1, hint: 'How many main roots grow out from the anchor.', change: (v) => { if (v > 0) mains = Math.max(2, Math.min(12, Math.round(v))); } }),
      h('div', { class: 'sketch-actions' },
        h('button', { type: 'button', class: 'primary', disabled: !anchor || !d.climate(), title: 'Grow roots out from the anchor along mountains, deep seas and coasts (in place of the roots there are now; Undo brings them back).', onclick: () => {
          const cl = d.climate();
          if (!anchor || !cl) return;
          const grown = growRoots(w.surface, w.settings, cl, anchor, { mains, seed: w.surface.nextId });
          d.replaceRoots(rootStrokes(grown, brushDefaults('root'), cl.wrapKm, w.surface.nextId));
          render();
        } }, roots.length ? 'Grow roots again' : 'Grow roots from the anchor'),
        h('button', { type: 'button', class: 'ghost danger', disabled: !roots.length, onclick: () => { d.replaceRoots([]); render(); } }, 'Remove all roots'),
      ),
      h('h3', {}, 'Nodes'),
      h('p', { class: 'small' }, kinds.size ? [...kinds].map(([k, n]) => `${n} ${NODE_NAMES[k as keyof typeof NODE_NAMES].toLowerCase()}${n === 1 ? '' : 's'}`).join(', ') + '.' : 'No nodes yet: volcanoes, whirlpools, high-pressure zones and the poles (on a globe) are nodes from the start.'),
      h('p', { class: 'muted small' }, 'While this tab is open the map shows the mana heat map, lines and nodes; elsewhere choose how mana shows under View.'),
    );
  };

  // ---- The map layer ----
  const overlay: MapOverlay = {
    draw(g, at, scale, copies) {
      const show: ManaDisplay = active ? 'heat' : d.display();
      if (show === 'off') return;
      const st = current();
      if (!st) return;
      const { grid } = st;
      g.save();
      if (show === 'heat') {
        const img = heatImage(st);
        g.imageSmoothingEnabled = true;
        for (const c of copies) {
          const [sx, sy] = at(grid.x0 - grid.step / 2, grid.y0 - grid.step / 2, c);
          g.drawImage(img, sx, sy, grid.w * grid.step * scale, grid.h * grid.step * scale);
        }
      }
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const trace = (p: number[], c: number) => {
        g.beginPath();
        for (let i = 0; i < p.length; i += 2) {
          const [x, y] = at(p[i], p[i + 1], c);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
      };
      for (const c of copies) {
        // Roots: thick and green-brown, sprouts thinner.
        for (const ln of st.lines) {
          if (ln.kind === 'ley') continue;
          const main = ln.kind === 'root';
          trace(ln.pts, c);
          g.strokeStyle = 'rgba(30,24,10,0.6)';
          g.lineWidth = main ? 6 : 3.5;
          g.stroke();
          g.strokeStyle = main ? '#6f9a34' : '#93b85a';
          g.lineWidth = main ? 3.5 : 2;
          g.stroke();
        }
        // Ley lines: fine glowing violet threads.
        g.setLineDash([7, 5]);
        for (const ln of st.lines) {
          if (ln.kind !== 'ley') continue;
          trace(ln.pts, c);
          g.strokeStyle = 'rgba(255,255,255,0.35)';
          g.lineWidth = 3;
          g.stroke();
          g.strokeStyle = 'rgba(176,110,255,0.95)';
          g.lineWidth = 1.4;
          g.stroke();
        }
        g.setLineDash([]);
        // Nodes, and the anchor.
        for (const nd of st.nodes) {
          const [x, y] = at(nd.x, nd.y, c);
          g.fillStyle = NODE_COLOUR[nd.kind] ?? '#fff';
          g.strokeStyle = 'rgba(20,10,30,0.9)';
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(x, y - 5);
          g.lineTo(x + 5, y);
          g.lineTo(x, y + 5);
          g.lineTo(x - 5, y);
          g.closePath();
          g.fill();
          g.stroke();
        }
        if (st.anchor) {
          const [x, y] = at(st.anchor.x, st.anchor.y, c);
          g.fillStyle = '#5b3a1a';
          g.fillRect(x - 2, y - 2, 4, 10);
          g.beginPath();
          g.arc(x, y - 6, 8, 0, Math.PI * 2);
          g.fillStyle = NODE_COLOUR.anchor;
          g.fill();
          g.strokeStyle = 'rgba(20,30,10,0.9)';
          g.lineWidth = 1.5;
          g.stroke();
        }
      }
      g.restore();
    },
    describe(x, y) {
      const show: ManaDisplay = active ? 'heat' : d.display();
      if (show === 'off') return null;
      const st = current();
      if (!st) return null;
      const { grid } = st;
      let i = Math.round((x - grid.x0) / grid.step);
      const j = Math.round((y - grid.y0) / grid.step);
      if (j < 0 || j >= grid.h) return null;
      if (i < 0 || i >= grid.w) {
        if (!grid.wrapKm) return null;
        i = ((i % grid.w) + grid.w) % grid.w;
      }
      const v = st.field[j * grid.w + i];
      const items: InfoItem[] = [{ label: 'Mana', value: `${manaWord(v)} (${Math.round(v * 100)}%)` }];
      return items;
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
    invalidate() {
      state = null;
      heatImg = null;
      if (active) render();
    },
  };
}
