import { BIOMES, Biome, Relief } from '../engine/data/biomes';
import { Res } from '../engine/data/economy';
import type { World } from '../engine/world';

const ROAD_STYLE = [
  { color: '', width: 0, min: 0 },
  { color: 'rgba(120, 90, 50, 0.55)', width: 0.08, min: 0.8 },
  { color: 'rgba(125, 82, 38, 0.8)', width: 0.14, min: 1.2 },
  { color: 'rgba(95, 95, 100, 0.9)', width: 0.2, min: 1.8 },
  { color: 'rgba(45, 45, 52, 0.95)', width: 0.28, min: 2.4 },
];
export const CARAVAN_COLOR: Record<string, string> = { merchant: '#e8b923', family: '#b57be0', nomad: '#d99152', convoy: '#3fbf7f' };

export type MapLayer = 'terrain' | 'political' | 'culture' | 'race' | 'resource';

export interface ViewState {
  layer: MapLayer;
  resource: Res;
  showRoutes: boolean;
  showLabels: boolean;
  showRuins: boolean;
  showCaravans: boolean;
  showArmies: boolean;
  showRoads: boolean;
  /** Progress through the current month (0..1) for smooth movement in real time. */
  frac: number;
  /** Screen pixels per tile. */
  zoom: number;
  /** Tile coordinate at the top-left of the canvas. */
  ox: number;
  oy: number;
  selectedSettlement: number;
  selectedPolity: number;
  selectedTile: number;
}

const colorCache = new Map<string, [number, number, number]>();

/** Parse "#rrggbb" or "hsl(h s% l%)" to RGB. */
export function toRgb(c: string): [number, number, number] {
  const hit = colorCache.get(c);
  if (hit) return hit;
  let rgb: [number, number, number] = [128, 128, 128];
  if (c.startsWith('#') && c.length === 7) {
    rgb = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  } else {
    const m = c.match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/);
    if (m) {
      const h = +m[1] / 360;
      const s = +m[2] / 100;
      const l = +m[3] / 100;
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const f = (t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      rgb = [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
    }
  }
  colorCache.set(c, rgb);
  return rgb;
}

/** Renders the world map: a cached shaded-relief base, a thematic overlay, then routes and settlements. */
export class MapRenderer {
  private base: HTMLCanvasElement;
  private overlay: HTMLCanvasElement;
  private overlayKey = '';

  constructor(private world: World) {
    const { width, height } = world.map;
    this.base = document.createElement('canvas');
    this.base.width = width;
    this.base.height = height;
    this.overlay = document.createElement('canvas');
    this.overlay.width = width;
    this.overlay.height = height;
    this.paintBase();
  }

  private paintBase(): void {
    const map = this.world.map;
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(map.width, map.height);
    const w = map.width;
    for (let i = 0; i < map.size; i++) {
      const b = map.biome[i];
      let [r, g, bl] = BIOMES[b].color;
      const e = map.elevation[i];
      if (e >= 0) {
        // Hillshade from the north-west.
        const x = i % w;
        const nw = x > 0 && i - w - 1 >= 0 ? Math.max(0, map.elevation[i - w - 1]) : e;
        const shade = 1 + Math.max(-0.35, Math.min(0.35, (nw - e) * -6));
        const lift = map.relief[i] === Relief.Mountains ? 1.08 : 1;
        r *= shade * lift;
        g *= shade * lift;
        bl *= shade * lift;
        if (map.temperature[i] < 0.18 && map.relief[i] === Relief.Mountains) [r, g, bl] = [236, 238, 242];
        if (map.river[i] > 0) {
          const k = Math.min(1, 0.45 + map.river[i] / (map.riverThreshold * 6));
          r = r * (1 - k) + 58 * k;
          g = g * (1 - k) + 118 * k;
          bl = bl * (1 - k) + 176 * k;
        }
      } else if (b !== Biome.Lake) {
        const depth = Math.min(1, -e);
        r *= 1 - depth * 0.35;
        g *= 1 - depth * 0.3;
        bl *= 1 - depth * 0.2;
      }
      img.data[i * 4] = Math.min(255, r);
      img.data[i * 4 + 1] = Math.min(255, g);
      img.data[i * 4 + 2] = Math.min(255, bl);
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  private paintOverlay(view: ViewState): void {
    const world = this.world;
    const map = world.map;
    const key = `${view.layer}:${view.resource}:${world.year}:${view.selectedPolity}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    const ctx = this.overlay.getContext('2d')!;
    ctx.clearRect(0, 0, map.width, map.height);
    if (view.layer === 'terrain') return;
    const img = ctx.createImageData(map.width, map.height);
    const d = img.data;
    const w = map.width;
    if (view.layer === 'resource') {
      const R = map.resources[view.resource];
      let max = 0;
      for (let i = 0; i < map.size; i++) max = Math.max(max, R[i]);
      for (let i = 0; i < map.size; i++) {
        const v = max > 0 ? R[i] / max : 0;
        if (v <= 0.02) continue;
        d[i * 4] = 250;
        d[i * 4 + 1] = 200 - v * 150;
        d[i * 4 + 2] = 40;
        d[i * 4 + 3] = 60 + v * 180;
      }
    } else {
      for (let i = 0; i < map.size; i++) {
        const o = map.owner[i];
        if (o < 0) continue;
        const s = world.settlements[o];
        let color: string;
        if (view.layer === 'political') color = world.polities[s.polityId].color;
        else if (view.layer === 'culture') color = world.cultures[s.cultureId].color;
        else color = world.majorityRace(s).color;
        const [r, g, b] = toRgb(color);
        // Borders drawn darker: tile differs from a neighbour in the same grouping.
        const group = (j: number) => {
          const oj = map.owner[j];
          if (oj < 0) return -1;
          const sj = world.settlements[oj];
          return view.layer === 'political' ? sj.polityId : view.layer === 'culture' ? sj.cultureId : world.majorityRaceId(sj) === world.majorityRaceId(s) ? -2 : -3;
        };
        const mine = group(i);
        const x = i % w;
        const edge =
          (x + 1 < w && group(i + 1) !== mine) || (x > 0 && group(i - 1) !== mine) ||
          (i + w < map.size && group(i + w) !== mine) || (i - w >= 0 && group(i - w) !== mine);
        const dim = view.selectedPolity >= 0 && view.layer === 'political' && s.polityId !== view.selectedPolity;
        d[i * 4] = edge ? r * 0.55 : r;
        d[i * 4 + 1] = edge ? g * 0.55 : g;
        d[i * 4 + 2] = edge ? b * 0.55 : b;
        d[i * 4 + 3] = edge ? 230 : dim ? 40 : map.elevation[i] < 0 ? 70 : 125;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  invalidate(): void {
    this.overlayKey = '';
  }

  draw(canvas: HTMLCanvasElement, view: ViewState, ink: { text: string; halo: string; accent: string }): void {
    const world = this.world;
    const map = world.map;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const z = view.zoom;
    const tx = (x: number) => (x - view.ox) * z;
    const ty = (y: number) => (y - view.oy) * z;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, tx(0), ty(0), map.width * z, map.height * z);
    this.paintOverlay(view);
    ctx.drawImage(this.overlay, tx(0), ty(0), map.width * z, map.height * z);

    const w = map.width;
    const cx = (t: number) => tx((t % w) + 0.5);
    const cy = (t: number) => ty(Math.floor(t / w) + 0.5);
    const pathTo = (path: number[], from = 0) => {
      ctx.beginPath();
      for (let k = from; k < path.length; k++) {
        if (k === from) ctx.moveTo(cx(path[k]), cy(path[k]));
        else ctx.lineTo(cx(path[k]), cy(path[k]));
      }
      ctx.stroke();
    };
    const x0 = Math.max(0, Math.floor(view.ox) - 1);
    const y0 = Math.max(0, Math.floor(view.oy) - 1);
    const x1 = Math.min(w, Math.ceil(view.ox + cw / z) + 1);
    const y1 = Math.min(map.height, Math.ceil(view.oy + ch / z) + 1);

    // Roads: each level drawn as its own line style, joining neighbouring road tiles.
    if (view.showRoads) {
      ctx.lineCap = 'round';
      for (let level = 1; level <= 4; level++) {
        const style = ROAD_STYLE[level];
        ctx.strokeStyle = style.color;
        ctx.lineWidth = Math.max(style.min, z * style.width);
        ctx.setLineDash(level === 1 ? [2, 3] : []);
        ctx.beginPath();
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = y * w + x;
            if ((map.road[i] | 0) < level) continue;
            // Right, down, and both down diagonals, so every link is drawn once.
            for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || nx >= w || ny >= map.height) continue;
              const j = ny * w + nx;
              if ((map.road[j] | 0) < level) continue;
              if (dx !== 0 && dy !== 0 && ((map.road[y * w + nx] | 0) >= level || (map.road[ny * w + x] | 0) >= level)) continue;
              ctx.moveTo(cx(i), cy(i));
              ctx.lineTo(cx(j), cy(j));
            }
          }
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Trade routes: where free traders and state convoys actually travel.
    if (view.showRoutes) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      let maxVol = 1;
      for (const r of world.routes.values()) maxVol = Math.max(maxVol, r.volume);
      for (const r of world.routes.values()) {
        if (r.path.length < 2) continue;
        const t = Math.sqrt(r.volume / maxVol);
        const a = 0.3 + 0.55 * t;
        ctx.strokeStyle = r.kind === 'convoy' ? `rgba(40, 150, 90, ${a})` : `rgba(214, 160, 40, ${a})`;
        ctx.lineWidth = Math.max(1, Math.min(4.5, 1 + t * 3.5));
        ctx.setLineDash(r.kind === 'convoy' ? [7, 4] : [4, 4]);
        pathTo(r.path);
      }
      ctx.setLineDash([]);
    }

    const frac = view.frac;
    const lerpTile = (a: number, b: number): [number, number] => [cx(a) + (cx(b) - cx(a)) * frac, cy(a) + (cy(b) - cy(a)) * frac];
    /** Position along a path between last month's step and this month's. */
    const along = (path: number[], from: number, to: number): [number, number] => {
      if (frac >= 1 || from >= to) return [cx(path[to]), cy(path[to])];
      const pos = from + (to - from) * frac;
      const k = Math.floor(pos);
      const f = pos - k;
      const a = path[Math.min(k, path.length - 1)];
      const b = path[Math.min(k + 1, path.length - 1)];
      return [cx(a) + (cx(b) - cx(a)) * f, cy(a) + (cy(b) - cy(a)) * f];
    };

    if (view.showCaravans && world.caravans.length) {
      for (const c of world.caravans) {
        const to = Math.min(c.step, c.path.length - 1);
        const [X, Y] = along(c.path, Math.min(c.prevStep, to), to);
        const r = Math.max(2, Math.min(5, 1.5 + Math.sqrt(c.size) * 0.35)) * Math.max(0.8, Math.min(1.5, z / 5));
        ctx.beginPath();
        if (c.kind === 'convoy') ctx.rect(X - r, Y - r, r * 2, r * 2);
        else ctx.arc(X, Y, r, 0, Math.PI * 2);
        ctx.fillStyle = CARAVAN_COLOR[c.kind];
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#2b2208';
        ctx.stroke();
      }
    }

    if (view.showArmies && world.armies.length) {
      for (const a of world.armies) {
        if (!a.alive) continue;
        const color = world.polities[a.polityId].color;
        if (a.path.length > a.step + 1) {
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          pathTo(a.path, a.step);
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
        const [X, Y] = lerpTile(a.prevTile, a.tile);
        const s = Math.max(5, Math.min(12, 3 + Math.log10(Math.max(10, a.size)) * 2)) * Math.max(0.8, Math.min(1.4, z / 5));
        ctx.beginPath();
        ctx.moveTo(X, Y - s);
        ctx.lineTo(X + s * 0.9, Y + s * 0.7);
        ctx.lineTo(X - s * 0.9, Y + s * 0.7);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = a.siege > 0 ? 2.5 : 1.5;
        ctx.strokeStyle = a.siege > 0 ? '#b3362f' : '#1b1b1b';
        ctx.stroke();
        if (view.showLabels && z >= 5) {
          const label = `${a.name} (${Math.round(a.size).toLocaleString('en-US')})${a.siege > 0 ? ' — besieging' : ''}`;
          ctx.font = `600 11px "Alegreya Sans", system-ui, sans-serif`;
          ctx.lineWidth = 3;
          ctx.strokeStyle = ink.halo;
          ctx.strokeText(label, X + s + 3, Y + s * 0.4);
          ctx.fillStyle = ink.text;
          ctx.fillText(label, X + s + 3, Y + s * 0.4);
        }
      }
      // Recent battles flare and fade; captured towns ring red.
      for (const m of world.battleMarks) {
        const age = world.monthIndex - m.at + (1 - frac);
        const life = m.kind === 'capture' ? 8 : 5;
        if (age > life) continue;
        const alpha = Math.max(0, 1 - age / life);
        const X = cx(m.tile);
        const Y = cy(m.tile);
        const r = (5 + Math.min(10, Math.log10(Math.max(10, m.size)) * 3)) * Math.max(0.8, Math.min(1.5, z / 5));
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = m.kind === 'capture' ? '#d62f2f' : '#1b1b1b';
        ctx.lineWidth = 2.5;
        if (m.kind === 'capture') {
          ctx.beginPath();
          ctx.arc(X, Y, r * (1 + age * 0.15), 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(X - r, Y - r);
          ctx.lineTo(X + r, Y + r);
          ctx.moveTo(X + r, Y - r);
          ctx.lineTo(X - r, Y + r);
          ctx.stroke();
          ctx.strokeStyle = '#f2c14e';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    // Settlements, largest last so they sit on top.
    const list = world.settlements.filter((s) => s.alive || (view.showRuins && s.peakPop > 800));
    list.sort((a, b) => a.pop - b.pop);
    ctx.font = `600 ${Math.max(10, Math.min(14, z * 2))}px "Alegreya Sans", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (const s of list) {
      const X = tx(s.x + 0.5);
      const Y = ty(s.y + 0.5);
      if (X < -20 || Y < -20 || X > cw + 20 || Y > ch + 20) continue;
      const isCapital = s.alive && world.polities[s.polityId].capitalId === s.id;
      const r = s.alive ? Math.max(2, Math.min(9, Math.log10(Math.max(10, s.pop)) * 1.6 - 1.5)) * Math.max(0.7, Math.min(1.6, z / 5)) : 2.5;
      ctx.beginPath();
      if (isCapital) {
        // A small crown-like diamond marks seats of power.
        ctx.moveTo(X, Y - r - 1.5);
        ctx.lineTo(X + r + 1.5, Y);
        ctx.lineTo(X, Y + r + 1.5);
        ctx.lineTo(X - r - 1.5, Y);
        ctx.closePath();
      } else ctx.arc(X, Y, r, 0, Math.PI * 2);
      ctx.fillStyle = s.alive ? '#f7f3ea' : 'rgba(120,110,100,0.7)';
      ctx.fill();
      ctx.lineWidth = s.id === view.selectedSettlement ? 3 : 1.5;
      ctx.strokeStyle = s.id === view.selectedSettlement ? ink.accent : s.alive ? world.polities[s.polityId].color : '#5a534c';
      ctx.stroke();
      const labelled = view.showLabels && (s.id === view.selectedSettlement || (s.alive && (isCapital ? z >= 2.5 || s.pop > 3000 : z >= 7 || (z >= 4 && s.pop > 2500))));
      if (labelled) {
        const text = s.alive ? s.name : `${s.name} (ruins)`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = ink.halo;
        ctx.strokeText(text, X + r + 4, Y);
        ctx.fillStyle = ink.text;
        ctx.fillText(text, X + r + 4, Y);
      }
    }

    if (view.selectedTile >= 0 && view.selectedSettlement < 0) {
      ctx.strokeStyle = ink.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(tx(view.selectedTile % map.width), ty(Math.floor(view.selectedTile / map.width)), z, z);
    }
  }
}
