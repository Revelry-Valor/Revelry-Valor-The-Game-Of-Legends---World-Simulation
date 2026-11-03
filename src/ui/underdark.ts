import type { Climate } from '../core/climate';
import type { Stroke } from '../core/paint';
import { shapeOf, tunnelLength, underdarkAt, underdarkSummary, underStrokes, UNDER_NAMES, waysDown, type WayDown } from '../core/underdark';
import { formatDistance, kmToMiles } from '../core/units';
import type { World } from '../core/world';
import { h } from './dom';
import type { InfoItem } from './info';
import type { MapOverlay } from './mapview';

/**
 * The Underdark tab and map layer (Phase 12 step 1): caverns, tunnels and underground seas cut
 * into the rock under the land, their ground cover, and the entrances and shafts that join them to
 * the surface. While the tab is open (or the Underdark is chosen under View) the map shows the
 * Underdark in place of the surface; elsewhere the ways down show as marks on the land.
 */

export interface UnderdarkDeps {
  world(): World;
  climate(): Climate | null;
  /** The Underdark is chosen under View (shown outside its tab too). */
  shownElsewhere(): boolean;
  /** Switch the layer on or off for this world. */
  setUsed(on: boolean): void;
}

export interface Underdark {
  panel: HTMLElement;
  overlay: MapOverlay;
  setActive(on: boolean): void;
  /** Whether the map shows the Underdark now. */
  showing(): boolean;
  /** The painting changed. */
  invalidate(): void;
}

const ROCK = '#2c2622';
const DEEP = '#0a121c';
const FLOOR = '#8a7a64';
const SEA = '#1d4d73';
const COVER_COLOUR: Record<string, string> = { fungus: 'rgba(170,90,200,0.8)', glowcave: 'rgba(80,235,200,0.75)', crystalcave: 'rgba(200,170,255,0.85)' };

export function createUnderdark(d: UnderdarkDeps): Underdark {
  let active = false;
  let landImg: HTMLCanvasElement | null = null;
  let landFor: Climate | null = null;
  const layers: HTMLCanvasElement[] = [];
  const showing = () => active || (d.shownElsewhere() && d.world().layers.underdark);

  /** The land grid as a picture: white where there is land, clear beyond it. */
  const landImage = (cl: Climate): HTMLCanvasElement => {
    if (landImg && landFor === cl) return landImg;
    const cv = document.createElement('canvas');
    cv.width = cl.w;
    cv.height = cl.h;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(cl.w, cl.h);
    for (let k = 0; k < cl.w * cl.h; k++) if (cl.land[k] === 1) img.data.set([255, 255, 255, 255], k * 4);
    g.putImageData(img, 0, 0);
    landImg = cv;
    landFor = cl;
    return cv;
  };
  const layer = (i: number, like: HTMLCanvasElement): CanvasRenderingContext2D => {
    let cv = layers[i];
    if (!cv) cv = layers[i] = document.createElement('canvas');
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

  /** Draw one painted shape (its dabs, or a tunnel's line) onto a layer. */
  const paint = (g: CanvasRenderingContext2D, st: Stroke, colour: string, at: (x: number, y: number, c: number) => [number, number], scale: number, copies: number[]) => {
    const sh = shapeOf(st);
    g.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
    g.fillStyle = colour;
    g.strokeStyle = colour;
    for (const c of copies) {
      if (!sh.dabs.length) {
        g.lineWidth = Math.max(1.5, sh.half * 2 * scale);
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        const p = st.pts;
        for (let i = 0; i < p.length; i += 2) {
          const [x, y] = at(p[i], p[i + 1], c);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        if (p.length === 2) g.lineTo(...at(p[0] + 0.01, p[1], c));
        g.stroke();
        continue;
      }
      g.beginPath();
      const dd = sh.dabs;
      for (let i = 0; i < dd.length; i += 3) {
        const [x, y] = at(dd[i], dd[i + 1], c);
        const r = Math.max(0.8, dd[i + 2] * scale);
        g.moveTo(x + r, y);
        g.arc(x, y, r, 0, Math.PI * 2);
      }
      g.fill();
    }
  };

  const drawWays = (g: CanvasRenderingContext2D, ways: WayDown[], at: (x: number, y: number, c: number) => [number, number], copies: number[], below: boolean) => {
    for (const c of copies) {
      for (const wd of ways) {
        const [x, y] = at(wd.x, wd.y, c);
        const lost = wd.below === 'rock';
        g.lineWidth = 1.5;
        if (wd.kind === 'entrance') {
          // A cave mouth: a dark arch on a stone rim.
          g.beginPath();
          g.moveTo(x - 6, y + 4);
          g.lineTo(x - 6, y);
          g.arc(x, y, 6, Math.PI, 0);
          g.lineTo(x + 6, y + 4);
          g.closePath();
          g.fillStyle = below ? '#f0d9a8' : '#1a1410';
          g.fill();
          g.strokeStyle = lost ? '#e05a4a' : below ? '#3a2c1a' : '#d9c9a8';
          g.stroke();
        } else {
          // A shaft: a ring with a dark well.
          g.beginPath();
          g.arc(x, y, 5, 0, Math.PI * 2);
          g.fillStyle = below ? '#f0d9a8' : '#0d0b0a';
          g.fill();
          g.strokeStyle = lost ? '#e05a4a' : below ? '#3a2c1a' : '#d9c9a8';
          g.stroke();
          g.beginPath();
          g.moveTo(x - 3, y - 3);
          g.lineTo(x + 3, y + 3);
          g.moveTo(x + 3, y - 3);
          g.lineTo(x - 3, y + 3);
          g.stroke();
        }
      }
    }
  };

  // ---- The tab ----
  const body = h('div', {});
  const panel = h('section', { class: 'view-panel underdark-panel' }, h('h2', {}, 'Underdark'), body);
  const render = () => {
    const w = d.world();
    const cl = d.climate();
    const ways = waysDown(w.surface);
    const painted = underStrokes(w.surface).length > 0;
    const sum = cl && painted ? underdarkSummary(w.surface, cl, (k) => cl.land[k] === 1) : null;
    const sq = (km2: number) => `${Math.round(kmToMiles(kmToMiles(km2))).toLocaleString('en-US')} sq mi`;
    const lines: string[] = [];
    if (sum) {
      if (sum.cavern) lines.push(`Caverns: about ${sq(sum.cavern)}.`);
      const tl = tunnelLength(w.surface);
      if (tl) lines.push(`Tunnels: about ${formatDistance(tl)} drawn.`);
      if (sum.sea) lines.push(`Underground seas: about ${sq(sum.sea)}.`);
      const cov = (['fungus', 'glowcave', 'crystalcave'] as const).filter((k) => sum[k]).map((k) => `${UNDER_NAMES[k].toLowerCase()} ${sq(sum[k])}`);
      if (cov.length) lines.push(`Ground cover: ${cov.join(', ')}.`);
    }
    const ent = ways.filter((x) => x.kind === 'entrance');
    const sh = ways.filter((x) => x.kind === 'shaft');
    const lost = ways.filter((x) => x.below === 'rock').length;
    body.replaceChildren(
      h('label', { class: 'field-row small' },
        h('input', { type: 'checkbox', checked: w.layers.underdark, onchange: (e: Event) => { d.setUsed((e.target as HTMLInputElement).checked); render(); } }),
        'This world has an Underdark'),
      h('p', { class: 'muted small' }, 'Caverns, tunnels and underground seas cut into the rock under the land. Beyond the coast everything is sea. Paint with the brushes above; erasing a cavern or tunnel fills it back with rock, erasing a sea drains it, and erasing any cover brush clears the cover there. Painting here never changes the surface, its climate or its provinces.'),
      h('h3', {}, 'What is painted'),
      h('p', { class: 'small' }, lines.length ? lines.join(' ') : painted && !cl ? 'Working out the land…' : 'Nothing yet: all solid rock.'),
      h('h3', {}, 'Ways down'),
      h('p', { class: 'small' }, ways.length ? `${ent.length} cave entrance${ent.length === 1 ? '' : 's'}, ${sh.length} shaft${sh.length === 1 ? '' : 's'}.${lost ? ` ${lost} open${lost === 1 ? 's' : ''} into solid rock (marked red): hollow a cavern or tunnel under ${lost === 1 ? 'it' : 'them'}.` : ''}` : 'None yet. Cave entrances are walked in and out; shafts are sheer drops that only climbers, flyers and those with ropes or lifts get through.'),
      h('p', { class: 'muted small' }, 'While this tab is open the map shows the Underdark; to see it from other tabs, choose it under View → Layers. On the surface, the ways down show as small marks. The peoples settle, dig and travel down here in a later step.'),
    );
  };

  // ---- The map layer ----
  const overlay: MapOverlay = {
    draw(g, at, scale, copies) {
      const w = d.world();
      const ways = waysDown(w.surface);
      if (!showing()) {
        if (ways.length) drawWays(g, ways, at, copies, false);
        return;
      }
      const cl = d.climate();
      const cv = g.canvas as HTMLCanvasElement;
      const tf = g.getTransform();
      g.save();
      // The deep beyond the land, then the rock under it.
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = DEEP;
      g.fillRect(0, 0, cv.width, cv.height);
      g.setTransform(tf);
      if (!cl) {
        g.restore();
        return;
      }
      const land = landImage(cl);
      const x0 = cl.x0 - cl.step / 2;
      const y0 = cl.y0 - cl.step / 2;
      // Rock: the land's shape, tinted.
      const rock = layer(0, cv);
      rock.setTransform(tf);
      rock.imageSmoothingEnabled = true;
      for (const c of copies) {
        const [sx, sy] = at(x0, y0, c);
        rock.drawImage(land, sx, sy, cl.w * cl.step * scale, cl.h * cl.step * scale);
      }
      rock.globalCompositeOperation = 'source-in';
      rock.setTransform(1, 0, 0, 1, 0, 0);
      rock.fillStyle = ROCK;
      rock.fillRect(0, 0, cv.width, cv.height);
      // Open floor, seas and cover, each on its own layer.
      const floor = layer(1, cv);
      const sea = layer(2, cv);
      const cover = layer(3, cv);
      for (const g2 of [floor, sea, cover]) g2.setTransform(tf);
      for (const st of underStrokes(w.surface)) {
        if (st.brush === 'cavern' || st.brush === 'tunnel') paint(floor, st, FLOOR, at, scale, copies);
        else if (st.brush === 'undersea') paint(sea, st, SEA, at, scale, copies);
        else paint(cover, st, st.erase ? '#000' : COVER_COLOUR[st.brush], at, scale, copies);
      }
      for (const g2 of [floor, sea, cover]) g2.setTransform(1, 0, 0, 1, 0, 0);
      // Cover only on dry floor; seas over everything; all of it only under the land.
      cover.globalCompositeOperation = 'destination-in';
      cover.drawImage(floor.canvas, 0, 0);
      floor.globalCompositeOperation = 'source-over';
      floor.drawImage(cover.canvas, 0, 0);
      floor.drawImage(sea.canvas, 0, 0);
      floor.globalCompositeOperation = 'destination-in';
      floor.drawImage(rock.canvas, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(rock.canvas, 0, 0);
      // The hollows sit down in the rock: a soft shadow round them.
      g.shadowColor = 'rgba(0,0,0,0.85)';
      g.shadowBlur = 8;
      g.drawImage(floor.canvas, 0, 0);
      g.shadowBlur = 0;
      g.shadowColor = 'transparent';
      g.setTransform(tf);
      if (ways.length) drawWays(g, ways, at, copies, true);
      g.restore();
    },
    describe(x, y) {
      const w = d.world();
      const near = waysDown(w.surface).find((wd) => Math.hypot(wd.x - x, wd.y - y) < 4);
      const items: InfoItem[] = [];
      if (near) items.push({ label: near.kind === 'entrance' ? 'Cave entrance' : 'Shaft', value: near.below === 'rock' ? 'Opens into solid rock (leads nowhere yet)' : `Down into ${UNDER_NAMES[near.below].toLowerCase()}` });
      if (!showing()) return items.length ? items : null;
      const cl = d.climate();
      if (!cl) return items.length ? items : null;
      let i = Math.round((x - cl.x0) / cl.step);
      const j = Math.round((y - cl.y0) / cl.step);
      if (cl.wrapKm) i = ((i % cl.w) + cl.w) % cl.w;
      const onLand = j >= 0 && j < cl.h && i >= 0 && i < cl.w && cl.land[j * cl.w + i] === 1;
      if (!onLand) {
        items.push({ label: 'Underdark', value: 'Beyond the land: sea' });
        return items;
      }
      const u = underdarkAt(underStrokes(w.surface), x, y);
      items.push({ label: 'Underdark', value: UNDER_NAMES[u.kind] + (u.cover ? ` · ${UNDER_NAMES[u.cover].toLowerCase()}` : '') });
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
    showing,
    invalidate() {
      if (active) render();
    },
  };
}


