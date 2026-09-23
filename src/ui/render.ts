import { BIOMES, Biome, Relief } from '../engine/data/biomes';
import { Res } from '../engine/data/economy';
import type { World } from '../engine/world';

export type MapLayer = 'terrain' | 'political' | 'culture' | 'race' | 'resource';

export interface ViewState {
  layer: MapLayer;
  resource: Res;
  showRoutes: boolean;
  showLabels: boolean;
  showRuins: boolean;
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

    // Roads that trade has worn into the land.
    if (z >= 3) {
      ctx.fillStyle = 'rgba(92, 64, 36, 0.55)';
      const x0 = Math.max(0, Math.floor(view.ox));
      const y0 = Math.max(0, Math.floor(view.oy));
      const x1 = Math.min(map.width, Math.ceil(view.ox + cw / z));
      const y1 = Math.min(map.height, Math.ceil(view.oy + ch / z));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const r = map.road[y * map.width + x];
          if (r < 0.15) continue;
          const s = Math.max(1, z * 0.18 * Math.min(2, r));
          ctx.fillRect(tx(x + 0.5) - s / 2, ty(y + 0.5) - s / 2, s, s);
        }
      }
    }

    if (view.showRoutes) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      let maxVol = 1;
      for (const l of world.links) maxVol = Math.max(maxVol, l.volume);
      for (const l of world.links) {
        if (l.volume <= 1 || l.path.length < 2) continue;
        const t = Math.sqrt(l.volume / maxVol);
        ctx.strokeStyle = l.sea ? `rgba(40, 110, 150, ${0.25 + 0.6 * t})` : `rgba(150, 96, 30, ${0.25 + 0.6 * t})`;
        ctx.lineWidth = Math.max(0.8, Math.min(4, z * 0.12 + t * 3));
        if (l.sea) ctx.setLineDash([4, 3]);
        else ctx.setLineDash([]);
        ctx.beginPath();
        for (let k = 0; k < l.path.length; k++) {
          const p = l.path[k];
          const X = tx((p % map.width) + 0.5);
          const Y = ty(Math.floor(p / map.width) + 0.5);
          if (k === 0) ctx.moveTo(X, Y);
          else ctx.lineTo(X, Y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
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
