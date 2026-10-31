import type { Climate } from '../core/climate';
import { raceMissing, type Library } from '../core/library';
import type { Surface } from '../core/paint';
import type { World } from '../core/world';
import { buildEnv, type Env } from '../sim/env';
import { packSim, unpackSim, type PackedSim } from '../sim/pack';
import { isFood, NEEDS, resInfoOf } from '../sim/economy';
import { baseWorth } from '../sim/trade';
import { bestWay, buildCost, knows, WAYS } from '../sim/ways';
import { addDawnCity, addTribe, clanLand, eligibleRaces, moveSettlement, moveTribe, newSim, placeStart, raceInfo, removeSettlement, removeTribe, stepDays, techOutlook } from '../sim/sim';
import { hasArchive, keepers } from '../sim/tech';
import { cultureOf, MAX_TRADITIONS } from '../sim/culture';
import { acceptance, acceptanceWord, cultureColour } from '../sim/cultureChange';
import type { Army, Battle, Clan, LiveCulture, LiveFaith, War } from '../sim/state';
import { kindName, total, UNIT_KINDS } from '../sim/battle';
import { govOf, preferredGov, realmName, rulerTitle } from '../sim/nations';
import { opinionWord, PACT_NAMES } from '../sim/politics';
import { faithColour, faithOf, ORGANIZATION_WORDS, realmFaith } from '../sim/faith';
import { activeWars, overlordOf, REASON_WORDS, sideOf, vassalsOf, WALL_NAMES, wallLevel, warOutlook, type WarContext } from '../sim/wars';
import { cultureFx } from '../sim/culture';
import { techTiers } from '../core/library';
import { dateText, DAYS_PER_MONTH, monthOf, northernSummer, yearOf, type Settlement, type SetupRow, type SimState, type StartKind, type Tribe } from '../sim/state';
import { choice, h, numberField, toast } from './dom';
import type { MapOverlay } from './mapview';
import { borderMap, holder, isOcc, OUTSIDE } from './borders';
import { evaluate } from '../core/terrain';
import type { InfoItem, ResourceView } from './info';

/**
 * The Peoples tab (Phase 6): choosing which races take part and placing their first tribes
 * (automatically, then moved, added or removed by hand), the time bar to run the world on, and
 * the map's layers for them: each clan's land, the tribes and their warbands, and where the
 * beasts are.
 */
export interface PeoplesDeps {
  world(): World;
  library(): Library;
  climate(): Climate | null;
  surface(): Surface;
  redraw(): void;
  changed(): void;
  /** Turn the map to a season (1 northern summer, −1 northern winter). */
  setSeason(season: 1 | -1): void;
  openLibrary(): void;
  /** Whether the climate is being worked out again (the land the peoples see may be out of date). */
  climateBusy(): boolean;
  /** The selected settlement or realm changed (or what it holds did). */
  selectionChanged?(): void;
  /** Open the Peoples tab (to show what the hand tool picked). */
  openPeoples?(): void;
}

export interface Peoples {
  panel: HTMLElement;
  bar: HTMLElement;
  overlay: MapOverlay;
  /** Whether the Peoples tab is open (the map's presses go to the peoples then). */
  setActive(on: boolean): void;
  climateChanged(): void;
  /** The simulation packed for saving (null if there is none). */
  pack(): PackedSim | null;
  /** The selected settlement's or realm's resources (for the resource panel), or null. */
  resources(): ResourceView | null;
  dispose(): void;
}

const SPEEDS = [
  { value: '1', label: 'Day', days: 1 },
  { value: '7', label: 'Week', days: 7 },
  { value: '30', label: 'Month', days: 30 },
  { value: '360', label: 'Year', days: 360 },
];
const SQ_MI = 0.386102;

export function createPeoples(d: PeoplesDeps): Peoples {
  let env: Env | null = null;
  let sim: SimState | null = null;
  let pending: PackedSim | null = d.world().sim ?? null;
  let gridProblem = false;
  let active = false;
  let selected: number | null = null;
  /** The realm (clan id) whose card is open, and the battle whose report is open. */
  let selectedRealm: number | null = null;
  let selectedBattle: number | null = null;
  let mode: 'select' | 'add' = 'select';
  let addRace = '';
  let addWhat: 'tribe' | 'dawn' = 'tribe';
  let addClan: 'new' | 'selected' = 'new';
  let showLand = true;
  let showBeast = '';
  let showRes = '';
  let showTrade = true;
  let showWays = true;
  let landsBy: 'clan' | 'culture' | 'faith' = 'clan';
  let resDirty = true;
  let resImg: HTMLCanvasElement | null = null;
  let follow = true;
  let playing = false;
  let speed = 30;
  let busy = false;
  let pxKm = 1;
  const draft = new Map<string, SetupRow>();
  /** Anyone left: tribes, or people in settlements. */
  const alive = () => !!sim && (sim.tribes.length > 0 || sim.settlements.some((q) => !q.ruined));

  const lib = () => d.library();
  const cl = () => d.climate();

  // ---------------------------------------------------------------------------------------------
  // The environment and the state

  const climateChanged = () => {
    const c = cl();
    if (!c) return;
    env = buildEnv(c, lib(), d.surface());
    if (!sim && pending) {
      sim = unpackSim(pending, env);
      if (!sim) {
        gridProblem = true;
        toast('The saved peoples were made on a map of another size; they could not be brought back. Start them again in the Peoples tab.');
      }
      pending = null;
    }
    if (sim && (sim.w !== env.w || sim.h !== env.h)) gridProblem = true;
    if (sim && !gridProblem) {
      // Beasts added to the library since: they start at home in their land.
      for (const b of env.beastInfo) if (!sim.beasts[b.id]) sim.beasts[b.id] = Float32Array.from(env.beastK[b.id], (v) => v * 0.9);
    }
    if (!sim) sim = newSim(env, d.world().settings.seed);
    landDirty = beastDirty = true;
    render();
    d.redraw();
  };
  const ready = () => !!(env && sim && !gridProblem);
  const cellOf = (x: number, y: number) => {
    if (!env) return -1;
    let i = Math.round((x - env.x0) / env.step);
    const j = Math.round((y - env.y0) / env.step);
    if (j < 0 || j >= env.h) return -1;
    if (i < 0 || i >= env.w) {
      if (!env.wrapKm) return -1;
      i = ((i % env.w) + env.w) % env.w;
    }
    return j * env.w + i;
  };
  const clanOf = (id: number) => sim?.clans.find((c) => c.id === id);
  const raceName = (id: string) => {
    for (const s of lib().species) {
      const r = s.races.find((q) => q.id === id);
      if (r) return r.name === s.name ? r.name : `${r.name} (${s.name})`;
    }
    return id;
  };

  // ---------------------------------------------------------------------------------------------
  // Running

  let frame = 0;
  let last = 0;
  let acc = 0;
  let lastSeason = 0;
  let panelTimer = 0;
  const afterStep = () => {
    if (!sim) return;
    landDirty = beastDirty = true;
    if (selected !== null && !sim.tribes.some((t) => t.id === selected) && !sim.settlements.some((q) => q.id === selected)) selected = null;
    const season = northernSummer(sim.day) ? 1 : -1;
    if (follow && season !== lastSeason && !(playing && speed >= 360)) d.setSeason(season);
    lastSeason = season;
    d.changed();
    d.redraw();
    updateBar();
    if (!panelTimer) panelTimer = window.setTimeout(() => {
      panelTimer = 0;
      render();
    }, 300);
  };
  const tick = (now: number) => {
    if (!playing || !sim || !env) return;
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    acc += dt * speed;
    const n = Math.floor(acc);
    if (n > 0) {
      acc -= n;
      sim.gods = d.world().settings.gods ?? { active: true, activity: 50 };
      stepDays(sim, env, lib(), n);
      afterStep();
      if (!alive()) {
        playing = false;
        toast('No peoples are left.');
        updateBar();
        return;
      }
    }
    frame = requestAnimationFrame(tick);
  };
  const play = (on: boolean) => {
    if (!ready() || !alive()) {
      playing = false;
      updateBar();
      return;
    }
    playing = on;
    cancelAnimationFrame(frame);
    if (on) {
      last = performance.now();
      acc = 0;
      frame = requestAnimationFrame(tick);
    }
    updateBar();
    render();
  };
  /** Run on a stretch of time, a month at a time so the screen keeps up. */
  const skip = (days: number) => {
    if (!ready() || busy || !alive()) return;
    play(false);
    busy = true;
    let left = days;
    const slice = () => {
      const t0 = performance.now();
      while (left > 0 && performance.now() - t0 < 30) {
        const n = Math.min(DAYS_PER_MONTH, left);
        sim!.gods = d.world().settings.gods ?? { active: true, activity: 50 };
        stepDays(sim!, env!, lib(), n);
        left -= n;
      }
      afterStep();
      if (left > 0 && alive()) window.setTimeout(slice, 0);
      else {
        busy = false;
        updateBar();
        render();
      }
    };
    slice();
  };

  // ---------------------------------------------------------------------------------------------
  // The time bar

  const playBtn = h('button', { type: 'button', class: 'primary', onclick: () => play(!playing) }, 'Play');
  const dateEl = h('span', { class: 'sim-date' });
  const skipBtns = [
    { label: '+1 month', days: 30 },
    { label: '+1 year', days: 360 },
    { label: '+10 years', days: 3600 },
  ].map((s) => h('button', { type: 'button', class: 'ghost small', onclick: () => skip(s.days) }, s.label));
  const speedSeg = choice('Speed (a second)', SPEEDS.map(({ value, label }) => ({ value, label })), String(speed), (v) => {
    speed = Number(v);
  });
  const bar = h('div', { class: 'sim-bar', hidden: true }, playBtn, speedSeg, ...skipBtns, dateEl);
  const updateBar = () => {
    const has = ready() && alive();
    bar.hidden = !has && !active;
    playBtn.textContent = playing ? 'Pause' : 'Play';
    playBtn.disabled = !has || busy;
    skipBtns.forEach((b) => (b.disabled = !has || busy));
    dateEl.textContent = !sim ? '' : busy ? `${dateText(sim.day)} · running…` : dateText(sim.day);
  };

  // ---------------------------------------------------------------------------------------------
  // The map

  let landDirty = true;
  let beastDirty = true;
  let landImg: HTMLCanvasElement | null = null;
  /** Border lines (km): polylines along the natural edges of the realms' lands; and when the land was last drawn. */
  let borderChains: { pts: number[]; left: number; right: number }[] = [];
  let borderRings = new Map<number, number[][]>();
  /** The painted land on the borders' fine grid (kept until the painting or the grid changes). */
  let fineLandCache: { surface: unknown; W: number; H: number; land: Uint8Array } | null = null;
  let landBuilt = 0;
  let landColours = new Map<number, number[]>();
  let beastImg: HTMLCanvasElement | null = null;
  const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const fieldImage = (paint: (data: Uint8ClampedArray) => void): HTMLCanvasElement => {
    const cv = h('canvas', { width: env!.w, height: env!.h }) as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(env!.w, env!.h);
    paint(img.data);
    g.putImageData(img, 0, 0);
    return cv;
  };
  const drawLand = () => {
    const s = sim!;
    const e = env!;
    // Each clan's colour, or its culture's.
    const colours = new Map(s.clans.map((c) => {
      const cu = landsBy === 'culture' ? cultureOf(s, c.culture) : undefined;
      const fa = landsBy === 'faith' ? realmFaith(s, c) : undefined;
      return [c.id, hex(cu ? cultureColour(s, cu) : fa ? faithColour(s, fa) : c.colour)];
    }));
    // Land round towns held by an enemy (its owner's land within about 30 miles): who holds it.
    const occupiedBy = new Map<number, number>();
    const reach = Math.ceil(50 / e.step);
    for (const st of s.settlements) {
      if (!st.occupied || st.ruined) continue;
      const ci = Math.round((st.x - e.x0) / e.step);
      const cj = Math.round((st.y - e.y0) / e.step);
      for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
        if (di * di + dj * dj > reach * reach) continue;
        const jj = cj + dj;
        let ii = ci + di;
        if (jj < 0 || jj >= e.h) continue;
        if (ii < 0 || ii >= e.w) {
          if (!e.wrapKm) continue;
          ii = ((ii % e.w) + e.w) % e.w;
        }
        const k = jj * e.w + ii;
        if (s.owner[k] === st.clan) occupiedBy.set(k, st.occupied.by);
      }
    }
    // Borders (borders.ts): the claims on a finer grid, the coast from the painting itself.
    const F = e.w * e.h > 120000 ? 2 : e.w * e.h > 40000 ? 3 : 4;
    const W = e.w * F;
    const H = e.h * F;
    const surface = d.surface();
    if (!fineLandCache || fineLandCache.surface !== surface || fineLandCache.W !== W || fineLandCache.H !== H) {
      const wsets = d.world().settings;
      const px = e.step / F;
      const f = evaluate(surface, { x0: e.x0 - e.step / 2 + px / 2, y0: e.y0 - e.step / 2 + px / 2, px, w: W, h: H }, { seed: wsets.seed, wrapKm: e.wrapKm, noRelief: true });
      const land = new Uint8Array(W * H);
      for (let q = 0; q < land.length; q++) land[q] = f.ground[q] >= 1.5 ? 1 : 0;
      fineLandCache = { surface, W, H, land };
    }
    const bm = borderMap({ w: e.w, h: e.h, wrap: !!e.wrapKm, land: e.land, owner: s.owner, occupied: new Set(occupiedBy.keys()), F, fineLand: fineLandCache.land });
    // Disputed land (being taken by another's use): hatched in the taker's colour.
    const cv = h('canvas', { width: bm.W, height: bm.H }) as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(bm.W, bm.H);
    const data = img.data;
    const stripe = Math.max(2, F);
    for (let q = 0; q < bm.label.length; q++) {
      const o = holder(bm.label[q]);
      if (o < 0) continue;
      const k = bm.cell[q];
      if (s.owner[k] !== o || s.rival[k] < 0 || s.rivalUse[k] <= 0) continue;
      const X = q % bm.W;
      const Y = (q / bm.W) | 0;
      if ((X + Y) % (stripe * 2) >= stripe) continue;
      const rc = hex(clanOf(s.rival[k])?.colour ?? '#888888');
      data.set([rc[0], rc[1], rc[2], 150], q * 4);
    }
    g.putImageData(img, 0, 0);
    // Lines and rings in km.
    const fx = e.step / F;
    const ox = e.x0 - e.step / 2;
    const oy = e.y0 - e.step / 2;
    const toKm = (l: number[]) => l.map((v, i) => (i % 2 ? oy + v * fx : ox + v * fx));
    borderChains = bm.chains.map((c) => ({ pts: toKm(c.pts), left: c.left, right: c.right }));
    borderRings = new Map([...bm.rings].map(([who, rings]) => [who, rings.map(toKm)]));
    landColours = colours;
    return cv;
  };

  const drawBeast = (id: string) => {
    const D = sim!.beasts[id];
    const e = env!;
    let max = 0;
    for (let k = 0; k < e.n; k++) max = Math.max(max, e.beastK[id]?.[k] ?? 0);
    return fieldImage((data) => {
      if (!D || !max) return;
      for (let k = 0; k < e.n; k++) {
        const v = D[k] / max;
        if (v <= 0.01) continue;
        // Pale yellow (few) to deep red (many).
        data.set([200 + 55 * (1 - v), 200 * (1 - v) + 30, 40, 40 + 110 * v], k * 4);
      }
    });
  };
  const drawRes = (id: string) => {
    const A = env!.res[id];
    return fieldImage((data) => {
      if (!A) return;
      for (let k = 0; k < env!.n; k++) {
        const v = Math.min(1, A[k]);
        if (v <= 0.01) continue;
        // Pale green (a little) to deep blue-green (plenty).
        data.set([150 - 130 * v, 210 - 60 * v, 120 + 40 * v, 60 + 150 * v], k * 4);
      }
    });
  };
  const overlay: MapOverlay = {
    get noPaint() {
      return active;
    },
    draw(g, at, scale, copies) {
      if (!ready()) return;
      const s = sim!;
      const e = env!;
      pxKm = 1 / scale;
      const blit = (img: HTMLCanvasElement, smooth = true) => {
        g.save();
        g.imageSmoothingEnabled = smooth;
        for (const c of copies) {
          const [sx, sy] = at(e.x0 - e.step / 2, e.y0 - e.step / 2, c);
          g.drawImage(img, sx, sy, e.w * e.step * scale, e.h * e.step * scale);
        }
        g.restore();
      };
      if (showRes) {
        if (resDirty || !resImg) resImg = drawRes(showRes);
        resDirty = false;
        blit(resImg);
      }
      if (showBeast) {
        if (beastDirty || !beastImg) beastImg = drawBeast(showBeast);
        beastDirty = false;
        blit(beastImg);
      }
      if (showLand && s.clans.length) {
        // Rebuilt when the claims change (at most once a second while the years run).
        const now = performance.now();
        if (!landImg || (landDirty && (!playing || now - landBuilt > 1000))) {
          landImg = drawLand();
          landBuilt = now;
          landDirty = false;
        }
        blit(landImg, false);
        // Crusader Kings borders: no fill; a strip of each realm's colour just inside its border
        // (clipped to its own land, so it never crosses the line), then a solid black line on every
        // border, dashed where land has been taken in a war (whose strip is red).
        const selRealm = selectedRealm ?? s.settlements.find((q) => q.id === selected)?.clan ?? s.tribes.find((t) => t.id === selected)?.clan ?? -1;
        const strip = Math.max(2.5, Math.min(5, e.step * scale * 0.5));
        const trace = (l: number[], c: number) => {
          for (let i = 0; i < l.length; i += 2) {
            const [x, y] = at(l[i], l[i + 1], c);
            if (i) g.lineTo(x, y);
            else g.moveTo(x, y);
          }
        };
        g.save();
        g.lineJoin = 'round';
        g.lineCap = 'round';
        for (const c of copies) {
          for (const [who, rings] of borderRings) {
            const o = holder(who);
            const chosen = o === selRealm;
            const rgb = isOcc(who) ? [205, 30, 30] : landColours.get(o) ?? [128, 128, 128];
            g.save();
            g.beginPath();
            for (const r of rings) {
              trace(r, c);
              g.closePath();
            }
            g.clip('evenodd');
            // A soft wash over the chosen realm, so it stands out.
            if (chosen) {
              g.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.18)`;
              g.fill('evenodd');
            }
            g.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${chosen ? 1 : 0.85})`;
            g.lineWidth = (chosen ? strip * 2.2 : strip) * 2;
            g.stroke();
            g.restore();
          }
          // The black lines (not along the map's own edge).
          for (const dashed of [false, true]) {
            g.beginPath();
            for (const ch of borderChains) {
              if (ch.left === OUTSIDE || ch.right === OUTSIDE) continue;
              const taken = holder(ch.left) >= 0 && holder(ch.left) === holder(ch.right);
              if (taken !== dashed) continue;
              trace(ch.pts, c);
            }
            g.setLineDash(dashed ? [6, 4] : []);
            g.strokeStyle = 'rgba(10,8,6,0.95)';
            g.lineWidth = 1.6;
            g.stroke();
          }
        }
        g.restore();
      }
      g.save();
      // Where the selected tribe is heading, and its two grounds.
      const sel = s.tribes.find((t) => t.id === selected);
      for (const c of copies) {
        if (sel) {
          const [ax, ay] = at(sel.x, sel.y, c);
          g.setLineDash([4, 4]);
          g.strokeStyle = 'rgba(255,255,255,0.85)';
          g.lineWidth = 1.5;
          for (const [p, label] of [[sel.summer, 'S'], [sel.winter, 'W']] as const) {
            const [px, py] = at(p.x, p.y, c);
            g.beginPath();
            g.moveTo(ax, ay);
            g.lineTo(px, py);
            g.stroke();
            g.fillStyle = 'rgba(0,0,0,0.6)';
            g.font = 'bold 11px system-ui, sans-serif';
            g.fillText(label, px + 4, py - 4);
          }
          g.setLineDash([]);
        }
        // Ways: trails, cart tracks, paved roads and railways, joining neighbouring points that have them.
        if (showWays) {
          const W = e.w;
          const segs: [number, number, number][] = [];
          for (let k = 0; k < e.n; k++) {
            const t = s.way[k];
            if (!t) continue;
            const i = k % W;
            const j = (k / W) | 0;
            for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
              let ii = i + di;
              const jj = j + dj;
              if (jj < 0 || jj >= e.h) continue;
              if (ii >= W) {
                if (!e.wrapKm) continue;
                ii -= W;
              }
              const m = jj * W + ii;
              // Diagonals only where the straight neighbours don't already join them.
              if (di && dj && (s.way[j * W + ((i + di) % W)] || s.way[jj * W + i])) continue;
              if (s.way[m]) segs.push([k, m, Math.min(t, s.way[m])]);
            }
          }
          const P = (k: number): [number, number] => at(e.x0 + (k % W) * e.step, e.y0 + ((k / W) | 0) * e.step, c);
          for (const tier of [1, 2, 3, 4]) {
            const mine = segs.filter((q) => q[2] === tier);
            if (!mine.length) continue;
            const line = (width: number, colour: string, dash: number[] = []) => {
              g.strokeStyle = colour;
              g.lineWidth = width;
              g.setLineDash(dash);
              g.beginPath();
              for (const [a, b] of mine) {
                const [ax, ay] = P(a);
                let [bx, by] = P(b);
                // Across the wrap: draw toward the near copy.
                if (Math.abs(bx - ax) > e.step * scale * 2) bx = ax + Math.sign(bx - ax) * -e.step * scale;
                g.moveTo(ax, ay);
                g.lineTo(bx, by);
              }
              g.stroke();
            };
            if (tier === 1) line(1.5, 'rgba(176,138,90,0.9)', [3, 3]);
            else if (tier === 2) line(2.5, '#8c5a2b');
            else if (tier === 3) {
              line(4.5, 'rgba(40,36,30,0.85)');
              line(2.5, '#e2ddd2');
            } else {
              line(4, '#1c1c1c');
              line(4, '#f2f2f2', [1.5, 5]);
            }
          }
          g.setLineDash([]);
          // Bridges: a stone-coloured span with dark parapets.
          if (s.bridge) for (let k = 0; k < e.n; k++) {
            if (!s.bridge[k]) continue;
            const [bx, by] = P(k);
            g.fillStyle = '#cfc6b4';
            g.strokeStyle = 'rgba(20,20,20,0.9)';
            g.lineWidth = 1.5;
            g.beginPath();
            g.rect(bx - 5, by - 3, 10, 6);
            g.fill();
            g.stroke();
          }
        }
        // Spies on their way: a small dark figure, with a faint line to where they are going.
        for (const sp of s.spies ?? []) {
          const [sx, sy] = at(sp.x, sp.y, c);
          const to = s.settlements.find((q) => q.id === (sp.leg === 'out' ? sp.target : clanOf(sp.from)?.realm?.capital));
          if (to) {
            const [tx, ty] = at(to.x, to.y, c);
            g.strokeStyle = 'rgba(30,30,30,0.45)';
            g.lineWidth = 1;
            g.setLineDash([2, 3]);
            g.beginPath();
            g.moveTo(sx, sy);
            g.lineTo(tx, ty);
            g.stroke();
            g.setLineDash([]);
          }
          g.fillStyle = '#141414';
          g.strokeStyle = '#e8e2d0';
          g.lineWidth = 1;
          g.beginPath();
          g.arc(sx, sy, 3.5, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
        // Towns held by an enemy: a striped ring in the occupier's colour.
        for (const st of s.settlements) {
          if (!st.occupied || st.ruined) continue;
          const [sx, sy] = at(st.x, st.y, c);
          g.lineWidth = 3;
          g.setLineDash([3, 3]);
          g.strokeStyle = clanOf(st.occupied.by)?.colour ?? '#000';
          g.beginPath();
          g.arc(sx, sy, 12, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
        // Towns under siege: a ring of the besiegers' colour, tight round the walls.
        for (const st of s.settlements) {
          if (!st.besieged || st.ruined) continue;
          const by = (s.armies ?? []).find((q) => q.id === st.besieged!.by);
          const [sx, sy] = at(st.x, st.y, c);
          g.strokeStyle = by ? clanOf(by.clan)?.colour ?? '#a00' : '#a00';
          g.lineWidth = 2;
          for (let i = 0; i < 10; i++) {
            const an = (i / 10) * Math.PI * 2;
            g.beginPath();
            g.arc(sx + Math.cos(an) * 15, sy + Math.sin(an) * 15, 2.2, 0, Math.PI * 2);
            g.stroke();
          }
        }
        // Battles of the last two years: crossed swords.
        for (const b of s.battles ?? []) {
          if (s.day - b.day > 720) continue;
          const [bx, by] = at(b.x, b.y, c);
          g.strokeStyle = 'rgba(20,20,20,0.9)';
          g.lineWidth = 3.5;
          for (const sgn of [1, -1]) {
            g.beginPath();
            g.moveTo(bx - 6 * sgn, by - 6);
            g.lineTo(bx + 6 * sgn, by + 6);
            g.stroke();
          }
          const fighting = (b.until ?? b.day) > s.day;
          if (fighting) {
            g.fillStyle = 'rgba(255,60,30,0.35)';
            g.beginPath();
            g.arc(bx, by, 13, 0, Math.PI * 2);
            g.fill();
          }
          g.strokeStyle = fighting || s.day - b.day < 60 ? '#ff5a3c' : '#d9d2c3';
          g.lineWidth = 1.6;
          for (const sgn of [1, -1]) {
            g.beginPath();
            g.moveTo(bx - 6 * sgn, by - 6);
            g.lineTo(bx + 6 * sgn, by + 6);
            g.stroke();
          }
        }
        // Armies: a banner in the realm's colour, with its strength, and a line to where it is going.
        for (const a of s.armies ?? []) {
          const [ax, ay] = at(a.x, a.y, c);
          const tgt = s.settlements.find((q) => q.id === a.target) ?? (s.armies ?? []).find((q) => q.id === a.target);
          if (tgt) {
            const [tx, ty] = at(tgt.x, tgt.y, c);
            g.strokeStyle = 'rgba(160,20,20,0.6)';
            g.lineWidth = 1.5;
            g.setLineDash([5, 4]);
            g.beginPath();
            g.moveTo(ax, ay);
            g.lineTo(tx, ty);
            g.stroke();
            g.setLineDash([]);
          }
          g.strokeStyle = '#111';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(ax, ay + 6);
          g.lineTo(ax, ay - 16);
          g.stroke();
          g.fillStyle = clanOf(a.clan)?.colour ?? '#888';
          g.beginPath();
          g.moveTo(ax, ay - 16);
          g.lineTo(ax + 14, ay - 12);
          g.lineTo(ax, ay - 7);
          g.closePath();
          g.fill();
          g.lineWidth = 1;
          g.stroke();
          const label = a.men >= 1000 ? `${(a.men / 1000).toFixed(1)}k` : String(Math.round(a.men));
          g.font = 'bold 11px system-ui, sans-serif';
          g.lineWidth = 3;
          g.strokeStyle = 'rgba(0,0,0,0.8)';
          g.fillStyle = a.goal === 'home' ? '#cfcfcf' : '#fff';
          g.strokeText(label, ax + 4, ay + 4);
          g.fillText(label, ax + 4, ay + 4);
        }
        // Holy sites: a gold star (dimmed where the faith has lost it).
        for (const f of s.faiths ?? []) for (const hs of f.holySites) {
          const [hx, hy] = at(hs.x, hs.y, c);
          g.beginPath();
          for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + (i * Math.PI) / 5;
            const r = i % 2 ? 2.6 : 6;
            g.lineTo(hx + 12 + Math.cos(a) * r, hy - 10 + Math.sin(a) * r);
          }
          g.closePath();
          g.fillStyle = hs.held ? faithColour(s, f) : 'rgba(150,150,150,0.6)';
          g.fill();
          g.lineWidth = 1.2;
          g.strokeStyle = hs.held ? '#f2c230' : 'rgba(60,60,60,0.8)';
          g.stroke();
        }
        // Trade routes: faint lines between trading settlements, bolder the more they are used; caravans on them.
        if (showTrade) {
          g.setLineDash([5, 4]);
          for (const r of s.routes) {
            const a = s.settlements.find((q) => q.id === r.a);
            const b = s.settlements.find((q) => q.id === r.b);
            if (!a || !b) continue;
            const [ax, ay] = at(a.x, a.y, c);
            const [bx, by] = at(b.x, b.y, c);
            g.strokeStyle = `rgba(255,214,110,${Math.min(0.95, 0.5 + r.trips / 30)})`;
            g.lineWidth = 2 + Math.min(3, r.trips / 10);
            g.beginPath();
            g.moveTo(ax, ay);
            g.lineTo(bx, by);
            g.stroke();
          }
          g.setLineDash([]);
          for (const cv of s.caravans) {
            const [sx, sy] = at(cv.x, cv.y, c);
            g.fillStyle = cv.train ? '#222' : '#c8913c';
            g.strokeStyle = '#2a1a08';
            g.lineWidth = 1.5;
            g.fillRect(sx - 3.5, sy - 3.5, 7, 7);
            g.strokeRect(sx - 3.5, sy - 3.5, 7, 7);
          }
        }
        // Settlements: a house (a dawn city bigger, ringed in gold: holy); ruins grey and broken.
        for (const st of s.settlements) {
          const [sx, sy] = at(st.x, st.y, c);
          const r = st.kind === 'dawn' ? 9 : 5 + Math.min(3, Math.sqrt(st.pop) / 10);
          g.beginPath();
          g.moveTo(sx - r, sy + r * 0.8);
          g.lineTo(sx - r, sy - r * 0.2);
          g.lineTo(sx, sy - r);
          g.lineTo(sx + r, sy - r * 0.2);
          g.lineTo(sx + r, sy + r * 0.8);
          g.closePath();
          if (st.ruined) {
            g.setLineDash([3, 2]);
            g.fillStyle = 'rgba(120,120,120,0.55)';
          } else g.fillStyle = clanOf(st.clan)?.colour ?? '#888';
          g.fill();
          g.lineWidth = st.id === selected ? 3 : st.holyTo.length ? 2.5 : 1.5;
          g.strokeStyle = st.id === selected ? '#ffffff' : st.holyTo.length ? '#f2c230' : 'rgba(0,0,0,0.8)';
          g.stroke();
          g.setLineDash([]);
          // A realm's capital: a crown above the house.
          const cap = !st.ruined && clanOf(st.clan)?.realm?.capital === st.id;
          if (cap) {
            const cy = sy - r - 3;
            g.beginPath();
            g.moveTo(sx - 5, cy);
            g.lineTo(sx - 5, cy - 6);
            g.lineTo(sx - 2.5, cy - 3);
            g.lineTo(sx, cy - 7);
            g.lineTo(sx + 2.5, cy - 3);
            g.lineTo(sx + 5, cy - 6);
            g.lineTo(sx + 5, cy);
            g.closePath();
            g.fillStyle = '#f2c230';
            g.fill();
            g.lineWidth = 1;
            g.strokeStyle = 'rgba(0,0,0,0.8)';
            g.stroke();
          }
          if (!st.ruined && st.fed < 0.8) {
            g.strokeStyle = '#ff4030';
            g.lineWidth = 1.5;
            g.beginPath();
            g.arc(sx, sy, r + 4, 0, Math.PI * 2);
            g.stroke();
          }
          if (st.kind === 'dawn' || scale > 0.12 || st.id === selected) {
            const label = st.ruined ? `${st.name} (ruins)` : st.name;
            g.font = st.kind === 'dawn' ? 'bold 12px system-ui, sans-serif' : '600 11px system-ui, sans-serif';
            g.lineWidth = 3;
            g.strokeStyle = 'rgba(0,0,0,0.75)';
            g.fillStyle = st.holyTo.length ? '#ffe28a' : '#fff';
            g.strokeText(label, sx + r + 4, sy + 4);
            g.fillText(label, sx + r + 4, sy + 4);
          }
        }
        // Warbands away: a diamond, with a line to where they are going.
        for (const so of s.sorties) {
          const [sx, sy] = at(so.x, so.y, c);
          const goal = so.leg === 'out' && so.targetKind === 'settlement' ? s.settlements.find((q) => q.id === so.target) : s.tribes.find((t) => t.id === (so.leg === 'out' ? so.target : so.tribe));
          if (goal) {
            const [gx, gy] = at(goal.x, goal.y, c);
            g.strokeStyle = so.leg === 'out' ? 'rgba(220,40,30,0.9)' : 'rgba(255,255,255,0.6)';
            g.lineWidth = 1.5;
            g.beginPath();
            g.moveTo(sx, sy);
            g.lineTo(gx, gy);
            g.stroke();
          }
          const r = 4 + Math.min(4, so.strength / 40);
          g.fillStyle = clanOf(so.clan)?.colour ?? '#888';
          g.strokeStyle = '#000';
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(sx, sy - r);
          g.lineTo(sx + r, sy);
          g.lineTo(sx, sy + r);
          g.lineTo(sx - r, sy);
          g.closePath();
          g.fill();
          g.stroke();
        }
        // Tribes: a dot in the clan's colour, bigger with more people.
        for (const t of s.tribes) {
          const [sx, sy] = at(t.x, t.y, c);
          const r = 4 + Math.min(6, Math.sqrt(t.pop) / 5);
          g.fillStyle = clanOf(t.clan)?.colour ?? '#888';
          g.strokeStyle = t.id === selected ? '#ffffff' : 'rgba(0,0,0,0.8)';
          g.lineWidth = t.id === selected ? 3 : 1.5;
          g.beginPath();
          g.arc(sx, sy, r, 0, Math.PI * 2);
          g.fill();
          g.stroke();
          if (t.fed < 0.8) {
            // Hungry: a red ring.
            g.strokeStyle = '#ff4030';
            g.lineWidth = 1.5;
            g.beginPath();
            g.arc(sx, sy, r + 3, 0, Math.PI * 2);
            g.stroke();
          }
          if (scale > 0.12 || t.id === selected) {
            g.font = '600 11px system-ui, sans-serif';
            g.lineWidth = 3;
            g.strokeStyle = 'rgba(0,0,0,0.7)';
            g.fillStyle = '#fff';
            g.strokeText(t.name, sx + r + 3, sy + 4);
            g.fillText(t.name, sx + r + 3, sy + 4);
          }
        }
      }
      g.restore();
    },
    down(x, y, pk) {
      if (!active || !ready()) return false;
      const s = sim!;
      const hit = tribeAt(x, y, pk);
      const hitCity = hit ? null : settlementAt(x, y, pk);
      // A battle on the map: open its report.
      if (!hit && !hitCity && s.started) {
        const b = [...(s.battles ?? [])].reverse().find((q) => s.day - q.day <= 720 && Math.hypot(q.x - x, q.y - y) < pk * 9);
        if (b) {
          selectedBattle = b.id;
          render();
          document.querySelector('.battle-report')?.scrollIntoView({ block: 'nearest' });
          return true;
        }
        // A realm's land: select the realm (the map still pans).
        const k = cellOf(x, y);
        if (mode === 'select' && k >= 0 && s.owner[k] >= 0 && clanOf(s.owner[k])) {
          selectedRealm = s.owner[k];
          selected = null;
          render();
          d.redraw();
          return false;
        }
      }
      if (mode === 'add' && !hit && !hitCity) {
        if (!addRace) {
          toast('Choose which race to add first.');
          return true;
        }
        const k = cellOf(x, y);
        if (k < 0 || !env!.land[k]) {
          toast(addWhat === 'dawn' ? 'A dawn city stands on land.' : 'Tribes are placed on land.');
          return true;
        }
        if (addWhat === 'dawn') {
          const st = addDawnCity(s, env!, lib(), addRace, x, y, draft.get(addRace)?.cityPop ?? 800);
          if (st) {
            selected = st.id;
            landDirty = true;
            d.changed();
            render();
          }
          return true;
        }
        const into = addClan === 'selected' ? s.tribes.find((t) => t.id === selected)?.clan ?? -1 : -1;
        const t = addTribe(s, env!, lib(), addRace, x, y, into, 150);
        if (t) {
          selected = t.id;
          landDirty = true;
          d.changed();
          render();
        }
        return true;
      }
      selected = hit?.id ?? hitCity?.id ?? null;
      render();
      d.redraw();
      if (hit && !s.started) {
        dragging = hit;
        return true;
      }
      if (hitCity && !s.started) {
        draggingCity = hitCity;
        return true;
      }
      return !!(hit || hitCity);
    },
    drag(x, y) {
      const m = dragging ?? draggingCity;
      if (!m) return;
      m.x = x;
      m.y = y;
    },
    up(x, y) {
      if (draggingCity && ready()) {
        const st = draggingCity;
        draggingCity = null;
        const k = cellOf(x, y);
        if (k >= 0 && env!.land[k]) moveSettlement(sim!, env!, lib(), st.id, x, y);
        else {
          toast('A dawn city stands on land.');
          moveSettlement(sim!, env!, lib(), st.id, cityFrom.x, cityFrom.y);
        }
        landDirty = true;
        d.changed();
        render();
        return;
      }
      if (!dragging || !ready()) return;
      const k = cellOf(x, y);
      if (k >= 0 && env!.land[k]) moveTribe(sim!, env!, lib(), dragging.id, x, y);
      else {
        toast('Tribes stay on land.');
        moveTribe(sim!, env!, lib(), dragging.id, dragging.summer.x, dragging.summer.y);
      }
      dragging = null;
      d.changed();
      render();
    },
    pick(x, y, pk) {
      if (!ready()) return false;
      const s = sim!;
      const t = tribeAt(x, y, pk);
      const st = t ? null : settlementAt(x, y, pk);
      const b = t || st ? undefined : [...(s.battles ?? [])].reverse().find((q) => s.day - q.day <= 720 && Math.hypot(q.x - x, q.y - y) < pk * 9);
      const k = cellOf(x, y);
      const realm = t || st || b || k < 0 || s.owner[k] < 0 ? null : clanOf(s.owner[k]);
      if (!t && !st && !b && !realm) return false;
      selected = t?.id ?? st?.id ?? null;
      selectedRealm = realm ? realm.id : null;
      if (b) selectedBattle = b.id;
      if (!active) d.openPeoples?.();
      render();
      d.redraw();
      // Bring its card into view in the panel.
      const name = t?.name ?? st?.name;
      if (name) requestAnimationFrame(() => [...panel.querySelectorAll('h3')].filter((x) => x.textContent === name).pop()?.scrollIntoView({ block: 'start' }));
      if (b) requestAnimationFrame(() => document.querySelector('.battle-report')?.scrollIntoView({ block: 'nearest' }));
      return true;
    },
    describe(x, y) {
      if (!ready()) return null;
      const s = sim!;
      const out: InfoItem[] = [];
      const push = (label: string, value: string) => out.push({ label, value });
      const t = tribeAt(x, y, pxKm);
      if (t) push('Tribe', `${t.name} (${clanOf(t.clan) ? realmName(lib(), clanOf(t.clan)!) : '?'}): ${Math.round(t.pop)} people, ${Math.round(Math.min(1, t.fed) * 100)}% fed`);
      const st = t ? null : settlementAt(x, y, pxKm);
      if (st) push('Settlement', settlementLine(st));
      if (showTrade) for (const cv of s.caravans) {
        let dx = Math.abs(cv.x - x);
        if (env!.wrapKm) dx = Math.min(dx, env!.wrapKm - dx);
        if (Math.hypot(dx, cv.y - y) > 8 * pxKm) continue;
        const from = s.settlements.find((q) => q.id === cv.from)?.name ?? '?';
        const to = s.settlements.find((q) => q.id === cv.to)?.name ?? '?';
        const goods = Object.entries(cv.cargo).map(([id, u]) => `${Math.round(u)} ${resInfoOf(env!, id)?.name.toLowerCase() ?? id}`).join(', ');
        push('Caravan', `${cv.train ? 'Train' : 'Caravan'} of ${from} (${cv.people} people${cv.animals ? `, ${cv.animals} pack animals` : ''}) ${cv.leg === 'out' ? `going to ${to}` : `coming home from ${to}`}${goods ? `, carrying ${goods}` : ''}`);
        break;
      }
      const k = cellOf(x, y);
      for (const a of s.armies ?? []) {
        if (Math.hypot(a.x - x, a.y - y) < pxKm * 12) push('Army', armyLine(a));
      }
      for (const b of s.battles ?? []) {
        if (s.day - b.day <= 720 && Math.hypot(b.x - x, b.y - y) < pxKm * 8) {
          const w = clanOf(b.winner);
          push('Battle', `${b.name}, year ${yearOf(b.day)}: ${w ? realmName(lib(), w) : '?'} won (${b.a.lost} and ${b.b.lost} fell)`);
        }
      }
      for (const f of s.faiths ?? []) for (const hs of f.holySites) {
        if (Math.hypot(hs.x + 12 * pxKm - x, hs.y - 10 * pxKm - y) < pxKm * 8) push('Holy site', `${hs.name}: holy site of the ${f.name}${hs.held ? '' : ' (lost to it)'}`);
      }
      for (const sp of s.spies ?? []) {
        const [sx, sy] = [sp.x, sp.y];
        if (Math.hypot(sx - x, sy - y) < pxKm * 6) {
          const from = clanOf(sp.from);
          const tgt = s.settlements.find((q) => q.id === sp.target);
          push('Spy', `${sp.name}, a spy of ${from ? realmName(lib(), from) : '?'}${sp.leg === 'out' ? `, on the way to ${tgt?.name ?? '?'}` : ', coming home'} (${({ steal: 'to steal its knowledge', unrest: 'to stir up unrest', sabotage: 'to burn its stores', watch: 'to watch and listen' } as const)[sp.mission]})`);
        }
      }
      if (k >= 0 && env!.land[k]) {
        const o = s.owner[k];
        if (o >= 0) push('Realm', `Land of ${clanOf(o) ? realmName(lib(), clanOf(o)!) : 'a clan now gone'}${s.rival[k] >= 0 && s.rivalUse[k] > 0 && clanOf(s.rival[k]) ? `, being taken by ${realmName(lib(), clanOf(s.rival[k])!)}` : ''}`);
        if (s.way[k]) {
          const keeper = s.settlements.find((q) => q.id === s.wayKeeper[k]);
          push('Way', `${WAYS[s.way[k]].name}${keeper ? ` (kept by ${keeper.name})` : s.way[k] === 1 ? ' (worn by use)' : ''}`);
        }
        if (s.bridge?.[k]) push('Crossing', 'A stone bridge');
        else if (env!.fresh[k] && s.way[k]) push('Crossing', 'A ford (no bridge yet: crossing is slow)');
        if (showRes) {
          const r = env!.resInfo.find((q) => q.id === showRes);
          if (r) push('Resource', env!.res[r.id][k] > 0.01 ? `${r.name} here (${Math.round(Math.min(1, env!.res[r.id][k]) * 100)}%)` : `No ${r.name.toLowerCase()} here`);
        }
        if (showBeast) {
          const b = env!.beastInfo.find((q) => q.id === showBeast);
          if (b) push('Beast', `${b.name}: ${Math.round((s.beasts[b.id][k] / Math.max(1e-6, env!.beastK[b.id][k] || 1)) * 100)}% of what the land carries`);
        }
      }
      return out.length ? out : null;
    },
  };
  let dragging: Tribe | null = null;
  let draggingCity: Settlement | null = null;
  let cityFrom = { x: 0, y: 0 };
  const settlementAt = (x: number, y: number, pk: number): Settlement | null => {
    if (!sim || !env) return null;
    let best: Settlement | null = null;
    let bd = 14 * pk;
    for (const st of sim.settlements) {
      let dx = Math.abs(st.x - x);
      if (env.wrapKm) dx = Math.min(dx, env.wrapKm - dx);
      const dd = Math.hypot(dx, st.y - y);
      if (dd < bd) {
        bd = dd;
        best = st;
      }
    }
    if (best) cityFrom = { x: best.x, y: best.y };
    return best;
  };
  const VERB: Record<string, string> = { Logged: 'Logging', Mined: 'Mining', Quarried: 'Quarrying', Gathered: 'Gathering', Farmed: 'Growing', Fished: 'Fishing', Herded: 'Herding', Hunted: 'Hunting', Crafted: 'Making' };
  /** A settlement's work, stores and harvest (units: one feeds one person for a month). */
  const economyCard = (st: Settlement, needPer: number): HTMLElement => {
    const e = st.economy!;
    const name = (id: string) => resInfoOf(env!, id)?.name ?? id;
    const jobName = (key: string) =>
      key.startsWith('farm:') ? `Farming ${name(key.slice(5)).toLowerCase()}` : key.startsWith('herd:') ? 'Herding' : key.startsWith('fish:') ? 'Fishing' : key === 'gather' ? 'Gathering wild food' : key === 'hunt' ? 'Hunting' : `${VERB[resInfoOf(env!, key)?.source ?? ''] ?? 'Working'} ${name(key).toLowerCase()}`;
    const jobs = Object.entries(e.jobs).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const need = st.pop * needPer;
    const food = Object.entries(e.stores).filter(([id]) => isFood(env!, id)).sort((a, b) => b[1] - a[1]);
    const foodUnits = food.reduce((n, [, v]) => n + v, 0);
    const other = Object.entries(e.stores).filter(([id]) => !isFood(env!, id)).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const yearWord = (y: number) => (y < 0.6 ? 'a failed harvest' : y < 0.9 ? 'a poor year' : y > 1.15 ? 'a good year' : 'an ordinary year');
    const u = (v: number) => Math.round(v).toLocaleString();
    return h('div', { class: 'tribe-card small econ' },
      h('div', { class: 'econ-head' }, 'Work'),
      jobs.length ? h('ul', { class: 'econ-list' }, ...jobs.map(([k, n]) => h('li', {}, h('span', {}, jobName(k)), h('span', { class: 'num' }, `${n}`)))) : h('div', { class: 'muted' }, 'Idle.'),
      (e.farmers ?? 0) > 0 && !jobs.some(([k]) => k.startsWith('farm:')) ? h('div', { class: 'muted' }, `${e.farmers} farmers work the fields in the growing season.`) : null,
      h('div', { class: 'econ-head' }, 'Food'),
      h('div', {}, `${u(foodUnits)} units in store: ${foodUnits >= need ? `about ${Math.floor(foodUnits / Math.max(1, need))} months` : 'less than a month'} of food.`),
      food.length ? h('ul', { class: 'econ-list' }, ...food.slice(0, 6).map(([id, v]) => h('li', {}, h('span', {}, name(id)), h('span', { class: 'num' }, u(v))))) : null,
      e.crop > 0 ? h('div', {}, `Growing: ${name(e.cropId).toLowerCase()}, about ${u(e.crop)} units so far.`) : null,
      e.harvest ? h('div', {}, `Last harvest: ${u(e.harvest.units)} units of ${name(e.cropId || '').toLowerCase() || 'crops'}, ${yearWord(e.harvest.year)} (Y${yearOf(e.harvest.day)}).`) : null,
      h('div', { class: 'econ-head' }, 'Other stores'),
      other.length ? h('ul', { class: 'econ-list' }, ...other.map(([id, v]) => h('li', {}, h('span', {}, name(id)), h('span', { class: 'num' }, u(v))))) : h('div', { class: 'muted' }, 'Nothing else kept.'),
      h('div', {}, `Needs beyond food (${NEEDS.map((n) => n.name.toLowerCase()).join(', ')}): ${Math.round(e.comfort * 100)}% met.`),
      ...marketPart(st),
      h('div', { class: 'muted' }, 'Units: one unit of a food feeds one person for a month.'),
    );
  };
  /** What a settlement knows of building ways, what it could build and what that costs, and what it keeps. */
  const waysCard = (st: Settlement): HTMLElement => {
    const L = lib();
    const s = sim!;
    const e = env!;
    const mi = e.step * 0.621;
    const best = bestWay(L, st);
    const techName = (id: string) => L.techs.find((t) => t.id === id)?.name ?? id;
    const kindName = (k: string) => (k === 'wood' ? 'wood' : k === 'stone' ? 'stone' : resInfoOf(e, k)?.name.toLowerCase() ?? k);
    const costText = (c: Record<string, number>) => Object.entries(c).map(([k, v]) => `${(v * 1.609).toFixed(1)} ${kindName(k)}`).join(', ');
    let kept = 0;
    const upkeep: Record<string, number> = {};
    for (let k = 0; k < e.n; k++) {
      if (s.wayKeeper[k] !== st.id || s.way[k] < 2) continue;
      kept++;
      for (const [kind, v] of Object.entries(buildCost(s.way[k], best.tech))) upkeep[kind] = (upkeep[kind] ?? 0) + v * e.step * WAYS[s.way[k]].upkeep;
    }
    return h('div', { class: 'tribe-card small econ' },
      h('div', { class: 'econ-head' }, 'Ways'),
      h('div', {}, best.tier >= 2 ? `Can build: ${WAYS[best.tier].name.toLowerCase()} (${techName(best.tech)}), along its busy trade routes, a few stretches a year.` : 'Can build: trails only (worn by use). Better ways need know-how:'),
      h('ul', { class: 'econ-list' }, ...WAYS.slice(2).map((w) => {
        const tech = w.techs.find((t) => knows(L, st, t)) ?? w.techs[0];
        const ok = w.techs.some((t) => knows(L, st, t));
        return h('li', {}, h('span', {}, `${ok ? '✓' : '·'} ${w.name}`), h('span', { class: 'muted' }, `${techName(tech)}; per mile ${costText(buildCost(w.tier, tech))}; upkeep ${Math.round(w.upkeep * 100)}% a year`));
      })),
      h('div', {}, kept ? `Keeps about ${Math.round(kept * mi)} miles of built ways; upkeep a year: ${Object.entries(upkeep).map(([k, v]) => `${Math.round(v)} ${kindName(k)}`).join(', ')}. Unpaid, they fall back a tier.` : 'Keeps no built ways.'),
    );
  };
  /** Which culture a race will live by: its Library culture, or a folk culture grown from its homeland. */
  const startCultureText = (raceId: string): string => {
    const L = lib();
    const sp = L.species.find((q) => q.races.some((r) => r.id === raceId));
    const made = L.cultures.find((c) => c.races.includes(raceId)) ?? (sp ? L.cultures.find((c) => c.species.includes(sp.id)) : undefined);
    return made ? `Culture: ${made.name} (from the Library).` : 'Culture: a folk culture will grow from its homeland and way of life (make one in the Library to choose it yourself).';
  };
  /** A realm: its government (parts), ruler, capital, centralization and how firmly it holds each town. */
  const realmCard = (cn: Clan): HTMLElement => {
    const L = lib();
    const s = sim!;
    const r = cn.realm;
    const g = r ? govOf(L, r.gov) : undefined;
    const towns = s.settlements.filter((q) => !q.ruined && q.clan === cn.id).sort((a, b) => (b.control ?? 0) - (a.control ?? 0) || b.pop - a.pop);
    const tribes = s.tribes.filter((t) => t.clan === cn.id);
    const capital = towns.find((q) => q.id === r?.capital);
    const pref = preferredGov(s, L, cn.culture);
    const pg = pref.gov ? govOf(L, pref.gov) : undefined;
    const age = r ? Math.floor((s.day - r.ruler.born) / 360) : 0;
    const part = (label: string, v: string | string[] | undefined) => (v && (!Array.isArray(v) || v.length) ? h('li', {}, h('span', { class: 'muted' }, label), h('span', {}, Array.isArray(v) ? v.join(', ') : v)) : null);
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    return h('div', { class: 'tribe-card small realm-card' },
      h('div', {}, h('span', { class: 'swatch', style: `background:${cn.colour}` }), h('b', {}, realmName(L, cn)), ` · ${raceName(cn.race)}`),
      cultureLine(cn.culture),
      (() => {
        const f = realmFaith(s, cn);
        return f ? h('div', {}, h('span', { class: 'swatch', style: `background:${faithColour(s, f)}` }), `Faith: the ${f.name}`, h('span', { class: 'muted' }, ` (${({ Tolerant: 'tolerates other faiths', Accepting: 'accepts other faiths', Wary: 'wary of other faiths', Intolerant: 'presses its faith on others', Hostile: 'persecutes other faiths' } as Record<string, string>)[f.tolerance] ?? ''})`)) : null;
      })(),
      ...(s.champions ?? []).filter((ch) => ch.clan === cn.id).map((ch) => h('div', {}, `Champion of ${L.gods.find((g) => g.id === ch.god)?.name ?? 'a god'}: ${ch.name} (its warriors fight the harder)`)),
      r ? h('div', {}, `${rulerTitle(L, cn)} ${r.ruler.name} of the house of ${r.ruler.house}, ${age} years old, ruling since year ${yearOf(r.ruler.since)}${r.reigns > 1 ? ` (reign ${r.reigns} of this realm)` : ''}.`) : null,
      h('div', {}, capital ? `Capital: ${capital.name}. ` : 'No capital: its tribes move with the seasons. ', `${towns.length} town${towns.length === 1 ? '' : 's'}, ${tribes.length} tribe${tribes.length === 1 ? '' : 's'}.`),
      g ? h('div', { class: 'econ-head' }, `Government: ${g.name}${r ? ` (since year ${yearOf(r.since)})` : ''}`) : null,
      g ? h('ul', { class: 'econ-list' }, part('Head', g.head), part('Ruling class', g.ruling), part('Land held by', g.land), part('Succession', g.succession), part('Legitimacy', g.legitimacy), part('Army', g.army), part('Law', g.law)) : null,
      h('div', { class: 'muted' }, pg ? `Its culture prefers: ${pg.name}${pref.hold ? ` (${pref.hold.toLowerCase()})` : ' (free to change)'}.` : 'Its culture has no preferred government: its conditions lead it (size, way of life, trade, the ways of rule it has learned).'),
      r ? h('div', {}, `Centralization: ${pct(r.centralization)}`, h('span', { class: 'muted' }, ' — how far its orders are felt; raised by writing, records, taxes, riders and roads.')) : null,
      towns.length > 1 ? h('div', { class: 'econ-head' }, 'How firmly it holds its towns') : null,
      towns.length > 1 ? h('ul', { class: 'econ-list' }, ...towns.slice(0, 12).map((q) => h('li', { class: 'clickable', onclick: () => { selected = q.id; selectedRealm = null; render(); d.redraw(); } }, h('span', {}, q.name, q.id === r?.capital ? h('span', { class: 'muted' }, ' (capital)') : null, q.culture !== cn.culture && cultureOf(s, q.culture) ? h('span', { class: 'muted' }, ` · ${cultureOf(s, q.culture)!.name}`) : null), h('span', { class: 'num' }, pct(q.control ?? 0))))) : null,
      towns.length > 12 ? h('div', { class: 'muted' }, `…and ${towns.length - 12} more.`) : null,
      ...politicsPart(cn, towns),
      ...warPart(cn),
    );
  };
  /** A realm's wars, and the realms it may go to war with (the reason, and the chance each year). */
  const warPart = (cn: Clan): (HTMLElement | null)[] => {
    const s = sim!;
    const L = lib();
    if (!s.started) return [];
    const wars = activeWars(s).filter((w) => sideOf(w, cn.id));
    const c = warContextUI();
    const outlook = s.clans
      .filter((o) => o !== cn)
      .map((o) => ({ o, w: warOutlook(c, cn, o) }))
      .filter((x) => x.w && x.w.chance > 0.001)
      .sort((a, b) => b.w!.chance - a.w!.chance)
      .slice(0, 4);
    const heroes = cn.realm?.heroes ?? [];
    const lord = overlordOf(s, cn.id);
    const vassals = vassalsOf(s, cn.id).map((v) => clanOf(v)).filter((q): q is Clan => !!q);
    const princes = cn.realm?.highPrinces ?? [];
    return [
      lord !== undefined && clanOf(lord) ? h('div', {}, `A vassal of ${realmName(L, clanOf(lord)!)}: it pays a tenth of its capital's stores each year and follows it to war.`) : null,
      vassals.length ? h('div', {}, `Vassals: ${vassals.map((v) => realmName(L, v)).join(', ')}.`) : null,
      princes.length ? h('div', { class: 'econ-head' }, 'High princes') : null,
      princes.length ? h('ul', { class: 'econ-list' }, ...princes.map((p) => h('li', {}, h('span', {}, `${p.name} of the house of ${p.house}`), h('span', { class: 'muted' }, `once ${p.was}, since Y${yearOf(p.since)}`)))) : null,
      heroes.length ? h('div', { class: 'econ-head' }, 'Heroes and generals at home') : null,
      heroes.length ? h('ul', { class: 'econ-list' }, ...heroes.map((hr) => h('li', {}, h('span', {}, hr.name, h('span', { class: 'muted' }, ` · ${hr.kind}`)), h('span', { class: 'muted' }, `${'★'.repeat(Math.max(1, Math.min(5, hr.power)))} · ${hr.deeds} deed${hr.deeds === 1 ? '' : 's'}`)))) : null,
      wars.length ? h('div', { class: 'econ-head' }, 'At war') : null,
      ...wars.map((w) => h('div', {}, `${w.name}: ${sideOf(w, cn.id) === 'attackers' ? 'attacking' : 'defending'}, war score ${Math.round(w.score)}`)),
      outlook.length && !wars.length ? h('div', { class: 'econ-head' }, 'Might go to war with') : null,
      ...(!wars.length ? outlook.map(({ o, w }) => h('div', { class: 'muted' }, `${realmName(L, o)}: ${REASON_WORDS[w!.reason]}, ${Math.round(w!.chance * 1000) / 10}% a year (odds ${w!.odds.toFixed(1)} to 1)`)) : []),
    ];
  };
  /** A realm's family, claimants, factions and relations with other realms. */
  const politicsPart = (cn: Clan, towns: Settlement[]): (HTMLElement | null)[] => {
    const L = lib();
    const s = sim!;
    const r = cn.realm;
    if (!r || !s.started) return [];
    const yrs = (born: number) => Math.floor((s.day - born) / 360);
    const fam = r.family ?? [];
    const claims = r.claimants ?? [];
    const restless = towns.filter((q) => (q.unrest ?? 0) > 0).sort((a, b) => (b.unrest ?? 0) - (a.unrest ?? 0));
    const rels = Object.entries(s.realmRelations ?? {})
      .map(([k, rel]) => {
        const [a, b] = k.split('|').map(Number);
        const other = a === cn.id ? b : b === cn.id ? a : -1;
        const oc = clanOf(other);
        return oc ? { oc, rel } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.rel.pacts.length - a.rel.pacts.length || b.rel.opinion - a.rel.opinion);
    const why = { heir: 'a passed-over heir', 'true line': 'the true line, put aside', marriage: 'by marriage', exile: 'driven out, in exile' } as const;
    return [
      fam.length ? h('div', { class: 'econ-head' }, 'The royal family') : null,
      fam.length ? h('ul', { class: 'econ-list' }, ...fam.map((k) => h('li', {}, h('span', {}, `${k.name} of ${k.house}`), h('span', { class: 'muted' }, `${k.female ? 'daughter' : 'son'}, ${yrs(k.born)}`)))) : null,
      claims.length ? h('div', { class: 'econ-head' }, 'Claimants to the throne') : null,
      claims.length ? h('ul', { class: 'econ-list' }, ...claims.map((q) => h('li', {}, h('span', {}, `${q.name} of ${q.house}`, h('span', { class: 'muted' }, ` · ${why[q.why]}${q.hostedBy !== undefined && clanOf(q.hostedBy) ? ` with ${realmName(L, clanOf(q.hostedBy)!)}` : ''}`)), h('span', { class: 'num' }, `${Math.round(q.backing * 100)}% backing`)))) : null,
      restless.length ? h('div', { class: 'econ-head' }, 'Discontented towns (a faction may rise)') : null,
      restless.length ? h('ul', { class: 'econ-list' }, ...restless.slice(0, 8).map((q) => h('li', {}, h('span', {}, q.name), h('span', { class: 'muted' }, `loyalty ${Math.round((q.loyalty ?? 0) * 100)}%, ${q.unrest} yr${q.unrest === 1 ? '' : 's'}`)))) : null,
      r.betrayals ? h('div', { class: 'muted' }, `It has broken ${r.betrayals} treat${r.betrayals === 1 ? 'y' : 'ies'} without cause; everyone remembers.`) : null,
      rels.length ? h('div', { class: 'econ-head' }, 'Relations with other realms') : null,
      rels.length
        ? h('ul', { class: 'econ-list' }, ...rels.slice(0, 10).map(({ oc, rel }) => h('li', {},
            h('span', {}, h('span', { class: 'swatch', style: `background:${oc.colour}` }), realmName(L, oc), rel.pacts.length ? h('div', { class: 'muted' }, rel.pacts.map((p) => `${PACT_NAMES[p.kind]}${p.roads ? ' (shared roads and bridges)' : ''}`).join(' · ')) : null, (rel.hostileUntil ?? -1) > s.day ? h('div', { class: 'muted' }, 'Takes up a quarrel against it') : null),
            h('span', { class: 'muted' }, `${opinionWord(rel.opinion)} (${rel.opinion >= 0 ? '+' : ''}${rel.opinion.toFixed(2)})`))))
        : null,
    ];
  };
  const armyLine = (a: Army): string => {
    const s = sim!;
    const cn = clanOf(a.clan);
    const tgt = s.settlements.find((q) => q.id === a.target);
    const foe = (s.armies ?? []).find((q) => q.id === a.target);
    const doing = a.goal === 'home' ? 'going home' : a.siege ? `besieging ${tgt?.name ?? '?'} (${a.siege.days} days${a.siege.breach ? `, walls ${Math.round(a.siege.breach * 100)}% breached` : ''})` : foe ? `marching to meet the ${foe.name}` : tgt ? `marching on ${tgt.name}` : 'holding';
    const mix = a.units ? ` (${UNIT_KINDS.filter((k) => (a.units![k] ?? 0) >= 1).map((k) => `${Math.round(a.units![k] ?? 0).toLocaleString()} ${kindName(k, a.specialists)}`).join(', ')})` : '';
    const heroes = (a.heroes ?? []).slice(1).map((h) => h.name);
    const fighting = (a.engagedUntil ?? -1) > s.day ? '; fighting a battle' : '';
    return `The ${a.name} (${cn ? realmName(lib(), cn) : '?'}): ${Math.round(a.men).toLocaleString()}${mix} under ${a.general}${heroes.length ? ` with ${heroes.join(', ')}` : ''}${fighting}, morale ${Math.round(a.morale * 100)}%, food for ${Math.max(0, Math.round((a.supply / Math.max(1, a.men)) * 30))} days; ${doing}`;
  };
  /** How war looks from a realm: its enemies, and the realms it may go to war with (and why). */
  const warContextUI = (): WarContext => {
    const s = sim!;
    const L = lib();
    return {
      sim: s,
      env: env!,
      lib: L,
      rand: () => 0.5,
      dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
      cellAt: (x, y) => cellOf(x, y),
      log: () => {},
      name: () => '',
      lifespan: () => 70,
      might: (race, culture) => (raceInfo(L, race, culture, s.cultures)?.might ?? 1) * cultureFx(s, culture).fight,
      speed: (race, culture) => (raceInfo(L, race, culture, s.cultures)?.speed ?? 15) * 0.9,
    };
  };
  /** A battle's report: the sides by kind of fighter, their heroes, each phase, and how it ended (once the fighting is over). */
  const battleReport = (b: Battle): HTMLElement => {
    const s = sim!;
    const r = b.report;
    const war = (s.wars ?? []).find((w) => w.id === b.war);
    const going = (b.until ?? b.day) > s.day;
    const head = h('div', {}, h('strong', {}, b.name), h('span', { class: 'muted' }, ` · ${war?.name ?? ''} · ${dateText(b.day)}${r ? ` · ${r.ground}` : ''}`));
    const close = h('button', { type: 'button', class: 'ghost small', onclick: () => { selectedBattle = null; render(); } }, 'Close');
    if (!r) return h('div', { class: 'tribe-card small battle-report' }, head, h('div', {}, `${b.a.army} (${b.a.men}) against ${b.b.army} (${b.b.men}): ${clanOf(b.winner)?.name ?? '?'} won; ${b.a.lost} and ${b.b.lost} fell.`), close);
    const n = (v: number | undefined) => Math.round(v ?? 0).toLocaleString();
    const kinds = UNIT_KINDS.filter((k) => (r.sides[0].units[k] ?? 0) >= 1 || (r.sides[1].units[k] ?? 0) >= 1);
    const lostBy = (i: 0 | 1, k: (typeof UNIT_KINDS)[number]) => r.phases.reduce((m, p) => m + (p.lost[i][k] ?? 0), 0);
    return h('div', { class: 'tribe-card small battle-report' },
      head,
      h('table', { class: 'clan-table small' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), ...r.sides.map((sd) => h('th', {}, h('span', { class: 'swatch', style: `background:${clanOf(sd.clan)?.colour ?? '#888'}` }), sd.label)))),
        h('tbody', {},
          ...kinds.map((k) => h('tr', {}, h('td', {}, kindName(k, r.sides[0].units.specialists ? r.sides[0].specialists : r.sides[1].specialists)), ...([0, 1] as const).map((i) => h('td', { class: 'num' }, going ? n(r.sides[i].units[k]) : `${n(r.sides[i].units[k])} (−${n(lostBy(i, k))})`)))),
          h('tr', {}, h('td', {}, h('b', {}, 'All')), ...([0, 1] as const).map((i) => h('td', { class: 'num' }, h('b', {}, going ? n(total(r.sides[i].units)) : `${n(total(r.sides[i].units))} (−${n(r.phases.reduce((m, p) => m + total(p.lost[i]), 0))})`)))),
          h('tr', {}, h('td', {}, 'Heroes'), ...r.sides.map((sd) => h('td', {}, sd.heroes.join(', ') || '—'))),
        ),
      ),
      going
        ? h('p', { class: 'muted' }, 'The armies are still fighting. The full report comes when the fighting stops.')
        : h('div', {},
            ...r.phases.map((p) => h('div', {}, h('span', { class: 'econ-head' }, `${p.name}: `), p.text)),
            ...r.notes.map((t) => h('div', { class: 'muted' }, t)),
            h('div', {}, h('b', {}, r.outcome)),
          ),
      close,
    );
  };
  /** A war: its sides, reason, score and weariness, armies and latest battles. */
  const warCard = (w: War): HTMLElement => {
    const L = lib();
    const s = sim!;
    const side = (ids: number[]) => ids.map((id) => clanOf(id)).filter((q): q is Clan => !!q);
    const names = (ids: number[]) => side(ids).map((q) => h('span', {}, h('span', { class: 'swatch', style: `background:${q.colour}` }), realmName(L, q), ` (weariness ${Math.round((w.weariness[q.id] ?? 0) * 100)}%)`));
    const armies = (s.armies ?? []).filter((a) => a.war === w.id);
    const battles = (s.battles ?? []).filter((b) => b.war === w.id).slice(-5).reverse();
    const lead = w.score >= 15 ? 'the attackers lead' : w.score <= -15 ? 'the defenders lead' : 'neither side leads';
    const goal = s.settlements.find((q) => q.id === w.goalTown);
    return h('details', { class: 'culture-card small', open: w.ended === undefined },
      h('summary', {}, h('strong', {}, w.name), h('span', { class: 'muted' }, ` · Y${yearOf(w.started)}${w.ended !== undefined ? `–${yearOf(w.ended)}` : ', going on'}`)),
      h('div', { class: 'tribe-card econ' },
        h('div', {}, `Why: ${REASON_WORDS[w.reason]}${goal ? ` (${goal.name})` : ''}${w.goalHouse ? ` (the house of ${w.goalHouse})` : ''}.`),
        h('div', {}, h('b', {}, 'Attackers: '), ...names(w.attackers)),
        h('div', {}, h('b', {}, 'Defenders: '), ...names(w.defenders)),
        w.ended === undefined ? h('div', {}, `War score ${w.score >= 0 ? '+' : ''}${Math.round(w.score)}: ${lead}. ${w.battles} battle${w.battles === 1 ? '' : 's'}; fallen: ${w.losses.attackers.toLocaleString()} attackers, ${w.losses.defenders.toLocaleString()} defenders.`) : h('div', {}, w.outcome ?? ''),
        armies.length ? h('div', { class: 'econ-head' }, 'Armies in the field') : null,
        armies.length ? h('ul', { class: 'econ-list' }, ...armies.map((a) => h('li', {}, h('span', {}, armyLine(a))))) : null,
        battles.length ? h('div', { class: 'econ-head' }, 'Latest battles') : null,
        battles.length ? h('ul', { class: 'econ-list' }, ...battles.map((b) => h('li', { class: 'clickable', title: 'Show the battle report', onclick: () => { selectedBattle = b.id; render(); document.querySelector('.battle-report')?.scrollIntoView({ block: 'nearest' }); } }, h('span', {}, `${b.name} (Y${yearOf(b.day)})`), h('span', { class: 'muted' }, (b.until ?? b.day) > s.day ? 'fighting…' : `${clanOf(b.winner)?.name ?? '?'} won · ${b.a.lost}/${b.b.lost} fell`)))) : null,
      ),
    );
  };
  const faithLine = (id: string | undefined, shift?: { to: string; progress: number }): HTMLElement | null => {
    const f = faithOf(sim!, id);
    if (!f) return null;
    return h('div', {}, h('span', { class: 'swatch', style: `background:${faithColour(sim!, f)}` }), `Faith: the ${f.name}`, shift && faithOf(sim!, shift.to) ? h('span', { class: 'muted' }, ` · being drawn to the ${faithOf(sim!, shift.to)!.name} (${Math.round(shift.progress * 100)}%)`) : null);
  };
  /** A faith: what it believes, how organized and fervent it is, its holy sites and gods, and who follows it. */
  const faithCard = (f: LiveFaith): HTMLElement => {
    const L = lib();
    const s = sim!;
    const towns = s.settlements.filter((q) => !q.ruined && q.faith === f.id);
    const tribes = s.tribes.filter((t) => t.faith === f.id);
    const people = towns.reduce((n, q) => n + q.pop, 0) + tribes.reduce((n, t) => n + t.pop, 0);
    const realms = s.clans.filter((q) => realmFaith(s, q) === f);
    const seat = s.settlements.find((q) => q.id === f.seat);
    const gods = f.gods.map((id) => L.gods.find((g) => g.id === id)?.name ?? id);
    return h('details', { class: 'culture-card small' },
      h('summary', {}, h('span', { class: 'swatch', style: `background:${faithColour(s, f)}` }), h('strong', {}, f.name), ` · ${Math.round(people).toLocaleString()} people`, h('span', { class: 'muted' }, ` · ${towns.length} settlements, ${tribes.length} tribes`)),
      h('div', { class: 'tribe-card econ' },
        h('div', {}, f.source ? `From the Library${f.hold ? ` (${f.hold.toLowerCase()} for its followers)` : ''}.` : f.blend ? `A blend of the ${f.blend.map((id) => faithOf(s, id)?.name ?? 'old faiths').join(' and the ')}, born year ${yearOf(f.founded)}.` : f.parent ? `Broke from the ${faithOf(s, f.parent)?.name ?? 'old faith'} in year ${yearOf(f.founded)}.` : 'The folk belief of its people’s homeland.'),
        h('div', {}, `Belief: ${f.nature.join(', ') || '—'} · Leads: ${f.leader || '—'} · Other faiths: ${f.tolerance.toLowerCase()}`),
        h('div', {}, `Organization: ${ORGANIZATION_WORDS[f.organization]}${seat ? `, seated at ${seat.name}` : ''}`),
        h('div', {}, `Fervour: ${Math.round(f.fervour * 100)}%`, h('span', { class: 'muted' }, ' — rises with holy sites held and the gods’ deeds; falls with losses, and in an old great hierarchy.')),
        h('div', { class: 'econ-head' }, 'Tenets'),
        f.tenets.length
          ? h('ul', { class: 'econ-list' }, ...f.tenets.map((t) => {
              const tn = L.tenets.find((q) => q.id === t.id);
              return h('li', { title: tn?.effects ?? '' }, h('span', {}, tn?.name ?? t.id), h('span', { class: 'muted' }, tn?.levels[t.level]?.name ?? ''));
            }))
          : h('div', { class: 'muted' }, 'None.'),
        h('div', { class: 'econ-head' }, 'Holy sites'),
        f.holySites.length ? h('ul', { class: 'econ-list' }, ...f.holySites.map((hs) => h('li', {}, h('span', {}, hs.name), h('span', { class: 'muted' }, `${hs.kind}${hs.held ? '' : ' · lost'}`)))) : h('div', { class: 'muted' }, 'None.'),
        h('div', {}, gods.length ? `Gods: ${gods.join(', ')}` : 'No gods named (make gods in the Library and give them to a faith, or favour a people with them).'),
        realms.length ? h('div', {}, `The faith of: ${realms.map((q) => realmName(L, q)).join(', ')}`) : null,
      ),
    );
  };
  /** The gods: who they watch over, their champions, and what they have done lately. */
  const godsPart = (): (HTMLElement | null)[] => {
    const L = lib();
    const s = sim!;
    const worshipped = L.gods.filter((g) => (s.faiths ?? []).some((f) => f.gods.includes(g.id)));
    if (!worshipped.length) return [];
    const off = s.gods && !s.gods.active;
    return [
      h('h3', {}, 'The gods'),
      off ? h('p', { class: 'muted small' }, 'Religion is belief only in this world (World settings): the gods do not act.') : null,
      ...worshipped.map((g) => {
        const champs = (s.champions ?? []).filter((ch) => ch.god === g.id);
        const last = s.godActs?.[g.id];
        const deeds = s.events.filter((e) => e.text.startsWith(g.name)).slice(-3).reverse();
        return h('div', { class: 'tribe-card small' },
          h('div', {}, h('strong', {}, g.name), g.titles ? h('span', { class: 'muted' }, `, ${g.titles}`) : null, g.domains.length ? h('span', { class: 'muted' }, ` · ${g.domains.join(', ')}`) : null),
          h('div', {}, `Worshipped by: ${(s.faiths ?? []).filter((f) => f.gods.includes(g.id)).map((f) => f.name).join(', ')}`),
          h('div', { class: 'muted' }, last !== undefined ? `Last acted in year ${yearOf(last)}.` : 'Has not acted yet.'),
          champs.length ? h('div', {}, `Champions: ${champs.map((ch) => `${ch.name} (${clanOf(ch.clan) ? realmName(L, clanOf(ch.clan)!) : '?'})`).join(', ')}`) : null,
          deeds.length ? h('ul', { class: 'econ-list' }, ...deeds.map((e) => h('li', {}, h('span', { class: 'muted' }, `Y${yearOf(e.day)}: ${e.text}`)))) : null,
        );
      }),
    ];
  };
  const cultureLine = (id: string): HTMLElement | null => {
    const cu = cultureOf(sim!, id);
    return cu ? h('div', {}, `Culture: ${cu.name}${cu.source ? '' : ' (folk)'}`) : null;
  };
  /** How a culture sees the others it knows (acceptance). */
  const acceptancePart = (cu: LiveCulture): HTMLElement[] => {
    const s = sim!;
    const known = (s.cultures ?? []).filter((o) => o !== cu && s.relations?.[cu.id < o.id ? `${cu.id}|${o.id}` : `${o.id}|${cu.id}`] && (s.settlements.some((q) => !q.ruined && q.culture === o.id) || s.tribes.some((t) => t.culture === o.id)));
    if (!known.length) return [];
    return [
      h('div', { class: 'econ-head' }, 'How it sees others'),
      h('ul', { class: 'econ-list' }, ...known.map((o) => {
        const v = acceptance(s, cu.id, o.id);
        return h('li', {}, h('span', {}, `The ${o.name}`), h('span', { class: 'muted' }, `${acceptanceWord(v)} (${v >= 0 ? '+' : ''}${v.toFixed(2)})`));
      })),
    ];
  };
  /** A culture: pillars, traditions (with their degree, and whether they are rising or fading), behaviours, and its people. */
  const cultureCard = (cu: LiveCulture): HTMLElement => {
    const L = lib();
    const s = sim!;
    const people = s.settlements.filter((q) => !q.ruined && q.culture === cu.id).reduce((n, q) => n + q.pop, 0) + s.tribes.filter((t) => t.culture === cu.id).reduce((n, t) => n + t.pop, 0);
    const places = s.settlements.filter((q) => !q.ruined && q.culture === cu.id).length;
    const roaming = s.tribes.filter((t) => t.culture === cu.id).length;
    const trad = (id: string) => L.traditions.find((t) => t.id === id);
    const held = cu.traditions.filter((t) => t.level >= 0);
    const forming = cu.traditions.filter((t) => t.level < 0 && t.progress > 0.2);
    const trend = (p: number) => (p > 0.25 ? ' · deepening' : p < -0.25 ? ' · fading' : '');
    const sample = cu.sounds.split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
    return h('details', { class: 'culture-card small' },
      h('summary', {}, h('span', { class: 'swatch', style: `background:${cultureColour(s, cu)}` }), h('strong', {}, cu.name), ` · ${Math.round(people).toLocaleString()} people`, h('span', { class: 'muted' }, ` · ${places} settlements, ${roaming} tribes`)),
      h('div', { class: 'tribe-card econ' },
        h('div', {}, cu.source ? 'From the Library.' : cu.blend ? `A blend of the ${cu.blend.map((id) => cultureOf(s, id)?.name ?? '?').join(' and the ')}, born year ${yearOf(cu.founded)}.` : cu.parent ? `Grew apart from the ${cultureOf(s, cu.parent)?.name ?? '?'} in year ${yearOf(cu.founded)}.` : 'A folk culture, grown from its homeland and way of life.'),
        h('div', {}, `Heritage: ${cu.races.map(raceName).join(', ')}`),
        h('div', {}, `Ethos: ${cu.ethos || '—'} · Who fights: ${cu.martial || '—'} · Ways of life: ${cu.lifestyles.join(', ') || 'none settled on'}`),
        sample ? h('div', { class: 'muted' }, `Its sounds: ${sample}`) : null,
        h('div', { class: 'econ-head' }, `Traditions (${held.length} of about ${MAX_TRADITIONS})`),
        held.length
          ? h('ul', { class: 'econ-list' }, ...held.map((t) => {
              const tr = trad(t.id);
              return h('li', { title: tr?.description ?? '' }, h('span', {}, tr?.name ?? t.id, t.hold ? h('span', { class: 'muted' }, ` (${t.hold.toLowerCase()})`) : null), h('span', { class: 'muted' }, `${tr?.levels[t.level]?.name ?? ''}${trend(t.progress)}`));
            }))
          : h('div', { class: 'muted' }, 'None yet.'),
        forming.length ? h('div', { class: 'muted' }, `Taking root: ${forming.map((t) => trad(t.id)?.name ?? t.id).join(', ')}.`) : null,
        cu.specialties.length ? h('div', {}, `Specialties: ${cu.specialties.map((q) => q.name).join(', ')}`) : null,
        ...acceptancePart(cu),
        h('div', { class: 'econ-head' }, 'Learned behaviours'),
        h('div', {}, cu.behaviours.map((b) => L.behaviours.find((q) => q.id === b)?.name ?? b).join(', ') || 'None yet.'),
        h('div', { class: 'muted' }, 'Traditions are earned by living a certain way for generations (about twenty years a degree) and fade when that life ends; behaviours spread by practice and from neighbours.'),
      ),
    );
  };
  /** A race's starting knowledge beyond survival: a fold of checkboxes by field. */
  const startKnowledge = (row: SetupRow): HTMLElement => {
    const L = lib();
    const chosen = new Set(row.techs ?? []);
    const fields = [...new Set(L.techs.filter((t) => !t.start).map((t) => t.field))];
    const summary = h('summary', {}, chosen.size ? `Knows beyond survival: ${chosen.size}` : 'Knows: survival only');
    return h('details', { class: 'start-know' }, summary,
      h('p', { class: 'muted' }, 'What its first tribes (and dawn city) know beyond gathering, hunting and simple fishing. Anything left out must be discovered or learned.'),
      ...fields.map((f) => h('div', { class: 'know-field' }, h('div', { class: 'econ-head' }, f),
        ...L.techs.filter((t) => !t.start && t.field === f).map((t) => h('label', { class: 'field-row' }, h('input', { type: 'checkbox', checked: chosen.has(t.id), onchange: (e: Event) => {
          if ((e.target as HTMLInputElement).checked) chosen.add(t.id);
          else chosen.delete(t.id);
          row.techs = [...chosen];
          summary.textContent = chosen.size ? `Knows beyond survival: ${chosen.size}` : 'Knows: survival only';
        } }), t.name)))),
    );
  };
  /** What a settlement (or a clan's tribes) knows, what it is likely to come to next, and (for trying things out) a way to give it a technology. */
  const knowledgeCard = (who: { st?: Settlement; clan?: number }): HTMLElement => {
    const L = lib();
    const s = sim!;
    const st = who.st;
    const clan = s.clans.find((c) => c.id === (st ? st.clan : who.clan));
    const learned = (st ? st.techs : clan?.techs) ?? [];
    const techOf = (id: string) => L.techs.find((t) => t.id === id);
    const byField = new Map<string, string[]>();
    for (const id of learned) {
      const t = techOf(id);
      if (!t) continue;
      byField.set(t.field, [...(byField.get(t.field) ?? []), t.name]);
    }
    const next = techOutlook(s, env!, L, st ? { settlement: st.id } : { clan: clan?.id ?? -1 });
    const tiers = techTiers(L.techs);
    const deepest = Math.max(0, ...learned.map((id) => tiers.get(id) ?? 1));
    const archive = st ? hasArchive(L, st, s.day) : false;
    const teach = h('select', { 'aria-label': 'Technology to give' }, h('option', { value: '' }, 'Choose…'), ...L.techs.filter((t) => !t.start && !learned.includes(t.id)).sort((a, b) => a.field.localeCompare(b.field) || a.name.localeCompare(b.name)).map((t) => h('option', { value: t.id }, `${t.field}: ${t.name}`))) as HTMLSelectElement;
    const setTechs = (v: string[]) => {
      if (st) st.techs = v;
      else if (clan) clan.techs = v;
      d.changed();
      render();
    };
    const pct = (p: number) => (p >= 0.095 ? `${Math.round(p * 100)}%` : p >= 0.01 ? `${(p * 100).toFixed(1)}%` : 'under 1%');
    return h('div', { class: 'tribe-card small econ' },
      h('div', { class: 'econ-head' }, st ? 'Knowledge' : 'Knowledge (its clan’s)'),
      learned.length
        ? h('ul', { class: 'econ-list' }, ...[...byField].map(([f, names]) => h('li', { class: 'know-row' }, h('span', { class: 'muted' }, f), h('span', {}, names.join(', ')))))
        : h('div', {}, 'Survival only: gathering, hunting and simple fishing.'),
      st && deepest > 0
        ? h('div', { class: 'muted' }, archive ? 'Its archive keeps what it knows from being forgotten.' : st.archiveBurnedUntil && st.archiveBurnedUntil > s.day ? 'Its archive was burned; what too few remember may be lost.' : `Its deepest knowledge needs about ${keepers(deepest)} people to keep alive without an archive, or neighbours who know it.`)
        : null,
      next.length ? h('div', {}, 'Likely next (chance a year):') : null,
      next.length ? h('ul', { class: 'econ-list' }, ...next.map((n) => h('li', {}, h('span', {}, `${n.tech.name}`, h('span', { class: 'muted' }, n.how === 'learn' ? ' (from those who know it)' : ' (finding it)')), h('span', { class: 'num' }, pct(n.chance))))) : null,
      h('div', { class: 'muted' }, 'To try things out, you can give a technology by hand.'),
      h('div', { class: 'teach-row' }, teach,
        h('button', { type: 'button', class: 'ghost small', onclick: () => { if (teach.value) setTechs([...learned, teach.value]); } }, 'Give'),
        learned.length ? h('button', { type: 'button', class: 'ghost small', onclick: () => setTechs(learned.slice(0, -1)) }, 'Take back the last') : null),
    );
  };
  /** The settlement's market: what is dear and cheap here, and its trade this past year. */
  const marketPart = (st: Settlement): HTMLElement[] => {
    const e = st.economy!;
    const p = e.prices ?? {};
    const name = (id: string) => resInfoOf(env!, id)?.name ?? id;
    const rel = (id: string) => p[id] / baseWorth(env!, id);
    const dear = Object.keys(p).filter((id) => rel(id) >= 1.6).sort((a, b) => rel(b) - rel(a)).slice(0, 5);
    const cheap = Object.keys(e.stores).filter((id) => p[id] && rel(id) <= 0.7).sort((a, b) => rel(a) - rel(b)).slice(0, 5);
    const fmt = (v: number) => (v >= 10 ? Math.round(v).toLocaleString() : v.toFixed(1));
    const row = (id: string) => h('li', {}, h('span', {}, name(id)), h('span', { class: 'num' }, `${fmt(p[id])} (×${rel(id).toFixed(1)})`));
    const partners = sim!.routes
      .filter((r) => r.a === st.id || r.b === st.id)
      .sort((a, b) => b.trips - a.trips)
      .slice(0, 4)
      .map((r) => `${sim!.settlements.find((q) => q.id === (r.a === st.id ? r.b : r.a))?.name ?? '?'} (${r.trips} trips)`);
    const t = e.traded;
    return [
      h('div', { class: 'econ-head' }, 'Market'),
      Object.keys(p).length
        ? h('div', { class: 'muted' }, 'Prices in the one currency (a unit of food at ease is about 1); ×: against its usual worth.')
        : h('div', { class: 'muted' }, 'Prices are set at the turn of the month.'),
      dear.length ? h('div', {}, 'Dear here (wanted):') : null,
      dear.length ? h('ul', { class: 'econ-list' }, ...dear.map(row)) : null,
      cheap.length ? h('div', {}, 'Cheap here (to spare):') : null,
      cheap.length ? h('ul', { class: 'econ-list' }, ...cheap.map(row)) : null,
      h('div', {}, t && t.caravans + t.in + t.out > 0 ? `Trade this year: ${t.caravans} caravan${t.caravans === 1 ? '' : 's'} sent; worth ${fmt(t.out)} out, ${fmt(t.in)} in (by barter).` : 'No trade this year.'),
      partners.length ? h('div', { class: 'muted' }, `Trades with: ${partners.join(', ')}.`) : null,
    ].filter(Boolean) as HTMLElement[];
  };
  const settlementLine = (st: Settlement) => {
    const what = st.kind === 'dawn' ? 'dawn city' : 'village';
    if (st.ruined) return `Ruins of ${st.name} (${what})${st.holyTo.length ? `, holy to the ${st.holyTo.map(raceName).join(', ')}` : ''}`;
    const cn = clanOf(st.clan);
    const occ = st.occupied ? clanOf(st.occupied.by) : undefined;
    return `${st.name} (${what}${cn?.realm?.capital === st.id ? ', capital' : ''}, ${cn ? realmName(lib(), cn) : '?'}${occ ? `; held by ${realmName(lib(), occ)}` : ''}): ${Math.round(st.pop)} people, ${Math.round(Math.min(1, st.fed) * 100)}% fed${st.holyTo.length ? `; holy to the ${st.holyTo.map(raceName).join(', ')}` : ''}`;
  };
  const tribeAt = (x: number, y: number, pk: number): Tribe | null => {
    if (!sim || !env) return null;
    let best: Tribe | null = null;
    let bd = 12 * pk;
    for (const t of sim.tribes) {
      let dx = Math.abs(t.x - x);
      if (env.wrapKm) dx = Math.min(dx, env.wrapKm - dx);
      const dd = Math.hypot(dx, t.y - y);
      if (dd < bd) {
        bd = dd;
        best = t;
      }
    }
    return best;
  };

  // ---------------------------------------------------------------------------------------------
  // The panel

  const panel = h('section', { class: 'view-panel peoples' });
  const render = () => {
    // The resource panel follows the selection (and what it holds).
    queueMicrotask(() => d.selectionChanged?.());
    updateBar();
    const c = cl();
    if (!c || !env || !sim) {
      panel.replaceChildren(h('h2', {}, 'Peoples'), h('p', { class: 'muted small' }, 'Working out the climate first: the peoples live by it.'));
      return;
    }
    if (gridProblem) {
      panel.replaceChildren(
        h('h2', {}, 'Peoples'),
        h('p', { class: 'notice small' }, 'The map has changed size since these peoples were placed (the climate is worked out on a new grid). Start them again to go on.'),
        h('button', { type: 'button', class: 'primary', onclick: () => { gridProblem = false; sim = newSim(env!, d.world().settings.seed); selected = null; d.changed(); render(); d.redraw(); } }, 'Start again'),
      );
      return;
    }
    const s = sim;
    const L = lib();
    const ok = eligibleRaces(L);
    const incomplete = L.species.filter((sp) => !sp.setAside).flatMap((sp) => sp.races.filter((r) => raceMissing(r).length));
    const parts: (HTMLElement | null)[] = [h('h2', {}, 'Peoples')];

    // Showing on the map
    const beasts = env.beastInfo;
    const beastSelect = h('select', { 'aria-label': 'Beast to show', onchange: (e: Event) => { showBeast = (e.target as HTMLSelectElement).value; beastDirty = true; d.redraw(); } },
      h('option', { value: '' }, 'No beasts'),
      ...beasts.map((b) => h('option', { value: b.id, selected: b.id === showBeast }, b.name)),
    );
    const display = h('div', { class: 'group' },
      choice<'on' | 'off'>('Clan lands', [{ value: 'on', label: 'Clan lands shown' }, { value: 'off', label: 'Hidden' }], showLand ? 'on' : 'off', (v) => { showLand = v === 'on'; d.redraw(); }),
      choice<'clan' | 'culture' | 'faith'>('Colour lands by', [{ value: 'clan', label: 'Realm' }, { value: 'culture', label: 'Culture' }, { value: 'faith', label: 'Faith' }], landsBy, (v) => { landsBy = v; landDirty = true; d.redraw(); render(); }),
      choice<'on' | 'off'>('Ways', [{ value: 'on', label: 'Trails, roads and railways shown' }, { value: 'off', label: 'Hidden' }], showWays ? 'on' : 'off', (v) => { showWays = v === 'on'; d.redraw(); }),
      h('div', { class: 'way-key small' }, ...WAYS.slice(1).map((w) => h('span', {}, h('span', { class: `way-swatch way-${w.id}` }), `${w.name} (×${w.speed} speed)`))),
      choice<'on' | 'off'>('Trade', [{ value: 'on', label: 'Trade routes and caravans shown' }, { value: 'off', label: 'Hidden' }], showTrade ? 'on' : 'off', (v) => { showTrade = v === 'on'; d.redraw(); }),
      h('div', { class: 'field' }, h('label', {}, 'Where beasts live'), beastSelect, h('small', {}, 'Yellow is few, red is many: as many as the land can carry, thinned where they are hunted.')),
      h('div', { class: 'field' }, h('label', {}, 'Where resources are'),
        h('select', { 'aria-label': 'Resource to show', onchange: (e: Event) => { showRes = (e.target as HTMLSelectElement).value; resDirty = true; d.redraw(); } },
          h('option', { value: '' }, 'No resources'),
          ...[...env.resInfo].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)).map((r) => h('option', { value: r.id, selected: r.id === showRes }, `${r.category}: ${r.name}`)),
        ),
        h('small', {}, 'Green where it is found; deeper where the land is better for it (or the deposit richer). From the Library’s resources: their climates, ground cover and terrain.'),
      ),
      h('label', { class: 'field-row small' }, h('input', { type: 'checkbox', checked: follow, onchange: (e: Event) => { follow = (e.target as HTMLInputElement).checked; } }), 'Map follows the season'),
    );

    if (!s.started) {
      // Setting up: which races, how many tribes, placed automatically, then by hand.
      if (!ok.length) {
        parts.push(
          h('p', { class: 'notice small' }, 'No race is complete yet, so none can take part. A race needs its size, all its stats, its fighting age and its lifespan.'),
          h('p', { class: 'small' }, `${incomplete.length} races are missing something. Fill them in in the Library (the Peoples tab there has a quick table for size, fighting age and lifespan).`),
          h('button', { type: 'button', class: 'primary', onclick: d.openLibrary }, 'Open the Library'),
        );
        panel.replaceChildren(...parts.filter(Boolean) as HTMLElement[]);
        return;
      }
      if (!draft.size) for (const r of s.setup.length ? s.setup : ok.map((o) => ({ race: o.race.id, tribes: 6, start: 'tribes' as StartKind, cityPop: 800 }))) draft.set(r.race, { start: 'tribes', cityPop: 800, ...r });
      if (!addRace || !ok.some((o) => o.race.id === addRace)) addRace = ok[0].race.id;
      const rows = ok.map(({ race }) => {
        const row = draft.get(race.id) ?? { race: race.id, tribes: 0, start: 'tribes' as StartKind, cityPop: 800 };
        draft.set(race.id, row);
        const on = row.tribes > 0 || row.start !== 'tribes';
        const num = (value: number, max: number, label: string, set: (v: number) => void, off = false) =>
          h('input', { type: 'number', min: 0, max, step: 1, value: String(value), disabled: off, 'aria-label': label, onchange: (e: Event) => set(Math.max(0, Math.min(max, Math.round(Number((e.target as HTMLInputElement).value) || 0)))) });
        const start = row.start ?? 'tribes';
        return h('div', { class: 'race-row' },
          h('label', { class: 'field-row small race-name' }, h('input', { type: 'checkbox', checked: on, onchange: (e: Event) => { const v = (e.target as HTMLInputElement).checked; row.tribes = v ? 6 : 0; if (!v) row.start = 'tribes'; render(); } }), raceName(race.id)),
          on
            ? h('div', { class: 'race-opts small' },
                h('label', {}, 'Begins as ', h('select', { 'aria-label': `How the ${race.name} begin`, onchange: (e: Event) => { row.start = (e.target as HTMLSelectElement).value as StartKind; if (row.start !== 'dawn' && !row.tribes) row.tribes = 6; render(); } },
                  ...([['tribes', 'Tribes'], ['dawn', 'Dawn city'], ['both', 'Dawn city and tribes']] as const).map(([v, l]) => h('option', { value: v, selected: start === v }, l)))),
                start !== 'dawn' ? h('label', {}, num(row.tribes, 40, `Tribes of ${race.name}`, (v) => (row.tribes = v)), ' tribes') : null,
                start !== 'tribes' ? h('label', {}, num(row.cityPop ?? 800, 20000, `People in the dawn city of the ${race.name}`, (v) => (row.cityPop = Math.max(30, v))), ' in the city') : null,
                startKnowledge(row),
                h('div', { class: 'muted' }, startCultureText(race.id)),
              )
            : null,
        );
      });
      parts.push(
        h('p', { class: 'muted small' }, 'Choose who takes part and how each begins: as scattered tribes, at its dawn city (where the race woke, holy to all of it wherever they go), or both. They are placed where the land suits them best; then drag tribes and dawn cities to move them, or add and remove tribes. Press Play (above the map) to begin.'),
        h('div', { class: 'race-pick' }, ...rows),
        incomplete.length ? h('p', { class: 'muted small' }, `${incomplete.length} more races can take part once they are complete in the Library.`, ' ', h('button', { type: 'button', class: 'ghost small', onclick: d.openLibrary }, 'Library')) : null,
        h('button', { type: 'button', class: 'primary', onclick: () => {
          if (d.climateBusy()) {
            toast('The climate is still being worked out after your last change. Place them in a moment, once it is done.');
            return;
          }
          const setup = [...draft.values()].filter((r) => r.tribes > 0 || r.start !== 'tribes');
          if (!setup.length) {
            toast('Tick at least one race.');
            return;
          }
          placeStart(s, env!, L, setup, c.zone);
          selected = null;
          landDirty = true;
          d.changed();
          render();
          d.redraw();
          const cities = s.settlements.length;
          toast(s.tribes.length || cities ? `Placed ${cities ? `${cities} dawn ${cities === 1 ? 'city' : 'cities'} and ` : ''}${s.tribes.length} tribes in ${s.clans.length} clans.` : 'No land here suits them: paint some land first, or check the races’ climates in the Library.');
        } }, s.tribes.length || s.settlements.length ? 'Place again automatically' : 'Place automatically'),
        h('h3', {}, 'On the map'),
        choice<'select' | 'add'>('Map tool', [{ value: 'select', label: 'Select & move' }, { value: 'add', label: 'Add' }], mode, (v) => { mode = v; render(); }),
        mode === 'add'
          ? h('div', { class: 'group' },
              choice<'tribe' | 'dawn'>('What', [{ value: 'tribe', label: 'A tribe' }, { value: 'dawn', label: 'The dawn city' }], addWhat, (v) => { addWhat = v; render(); }),
              h('div', { class: 'field' }, h('label', {}, 'Race'), h('select', { onchange: (e: Event) => { addRace = (e.target as HTMLSelectElement).value; } }, ...ok.map((o) => h('option', { value: o.race.id, selected: o.race.id === addRace }, raceName(o.race.id))))),
              addWhat === 'tribe'
                ? choice<'new' | 'selected'>('Clan', [{ value: 'new', label: 'A new clan' }, { value: 'selected', label: 'The selected tribe’s clan', disabled: selected === null }], addClan, (v) => { addClan = v; })
                : null,
              h('p', { class: 'muted small' }, addWhat === 'dawn' ? 'Click the map to set the race’s dawn city there (each race has one: if it has one already, it moves).' : 'Click the map to place a tribe there.'),
            )
          : h('p', { class: 'muted small' }, 'Click a tribe or dawn city to see it; drag it to move it (a tribe’s summer and winter grounds move with it).'),
      );
    } else {
      // Running: how things stand.
      const living = s.settlements.filter((q) => !q.ruined);
      const people = s.tribes.reduce((n, t) => n + t.pop, 0) + living.reduce((n, q) => n + q.pop, 0);
      const land = clanLand(s, env);
      parts.push(
        h('p', { class: 'summary' }, `${dateText(s.day)}\n${s.tribes.length} tribes and ${living.length} settlements in ${s.clans.length} clans, ${Math.round(people).toLocaleString()} people`),
      );
      const clanRows = [...s.clans]
        .map((cn) => ({ cn, tribes: [...s.tribes.filter((t) => t.clan === cn.id), ...s.settlements.filter((q) => !q.ruined && q.clan === cn.id)] }))
        .sort((a, b) => b.tribes.reduce((n, t) => n + t.pop, 0) - a.tribes.reduce((n, t) => n + t.pop, 0))
        .map(({ cn, tribes }) =>
          h('tr', { class: `clickable${selectedRealm === cn.id ? ' picked' : ''}`, onclick: () => { selectedRealm = selectedRealm === cn.id ? null : cn.id; selected = null; render(); d.redraw(); } },
            h('td', {}, h('span', { class: 'swatch', style: `background:${cn.colour}` }), realmName(L, cn), h('div', { class: 'muted' }, `${raceName(cn.race)}${cn.realm ? ` · ${rulerTitle(L, cn)} ${cn.realm.ruler.name}` : ''}`)),
            h('td', { class: 'num' }, `${tribes.filter((q) => !('summer' in q)).length} / ${tribes.filter((q) => 'summer' in q).length}`),
            h('td', { class: 'num' }, Math.round(tribes.reduce((n, t) => n + t.pop, 0)).toLocaleString()),
            h('td', { class: 'num' }, Math.round((land.get(cn.id) ?? 0) * SQ_MI).toLocaleString()),
          ),
        );
      parts.push(
        h('h3', {}, 'Realms'),
        h('p', { class: 'muted small' }, 'Every clan is a realm, from a band of tribes under its chief to a kingdom or empire. Click one to see how it is ruled.'),
        h('div', { class: 'table-scroll' }, h('table', { class: 'clan-table small' }, h('thead', {}, h('tr', {}, h('th', {}, 'Realm'), h('th', {}, 'Towns / tribes'), h('th', {}, 'People'), h('th', {}, 'Land, sq mi'))), h('tbody', {}, ...clanRows))),
      );
      const rc = s.clans.find((q) => q.id === selectedRealm);
      if (rc) parts.push(realmCard(rc));
      if (s.settlements.length) {
        const order = [...s.settlements].sort((a, b) => (a.kind === 'dawn' ? 0 : 1) - (b.kind === 'dawn' ? 0 : 1) || b.pop - a.pop);
        parts.push(
          h('h3', {}, 'Settlements'),
          h('div', { class: 'table-scroll' }, h('table', { class: 'clan-table small' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'People'))),
            h('tbody', {}, ...order.map((q) => h('tr', { class: 'clickable', onclick: () => { selected = q.id; render(); d.redraw(); } },
              h('td', {}, h('span', { class: 'swatch', style: `background:${q.ruined ? '#888' : clanOf(q.clan)?.colour ?? '#888'}` }), q.name, q.kind === 'dawn' ? h('span', { class: 'holy-tag' }, ' dawn city') : null, h('div', { class: 'muted' }, raceName(q.race))),
              h('td', { class: 'num' }, q.ruined ? 'ruins' : Math.round(q.pop).toLocaleString()),
            ))),
          )),
        );
      }
    }

    // Wars, going on and lately ended.
    const wars = [...activeWars(s), ...(s.wars ?? []).filter((w) => w.ended !== undefined).slice(-6).reverse()];
    const openBattle = (s.battles ?? []).find((b) => b.id === selectedBattle);
    if (openBattle) parts.push(h('h3', {}, 'Battle report'), battleReport(openBattle));
    if (s.started && wars.length) parts.push(h('h3', {}, 'Wars'), h('p', { class: 'muted small' }, 'Settled realms go to war for a reason (a claim, a throne, their faith, vengeance, their own people, or plain conquest). Banners on the map are armies; crossed swords are battles.'), ...wars.map((w) => warCard(w)));

    // Treaties, the world over.
    const treaties = Object.entries(s.realmRelations ?? {}).flatMap(([k, rel]) => {
      const [a, b] = k.split('|').map(Number);
      const A = clanOf(a);
      const B = clanOf(b);
      return A && B && rel.pacts.length ? [{ A, B, rel }] : [];
    });
    if (s.started && (treaties.length || s.spies?.length)) {
      const L = lib();
      parts.push(
        h('h3', {}, 'Treaties'),
        h('p', { class: 'muted small' }, 'Realms whose people have learned to send envoys make pacts. Breaking a promise of peace without cause is remembered by everyone; defending an ally is a justified break.'),
        treaties.length
          ? h('ul', { class: 'treaty-list small' }, ...treaties.map(({ A, B, rel }) => h('li', {},
              h('div', {}, h('span', { class: 'swatch', style: `background:${A.colour}` }), realmName(L, A), ' & ', h('span', { class: 'swatch', style: `background:${B.colour}` }), realmName(L, B)),
              h('div', { class: 'muted' }, rel.pacts.map((p) => `${PACT_NAMES[p.kind]}${p.roads ? ' (shared roads and bridges)' : ''} since Y${yearOf(p.since)}`).join(' · ')))))
          : h('p', { class: 'muted small' }, 'No treaties yet.'),
        s.spies?.length ? h('p', { class: 'small' }, `${s.spies.length} spy${s.spies.length === 1 ? '' : 'ies'} abroad (dark dots on the map).`) : null,
      );
    }

    // Trade, the world over.
    if (s.started && (s.routes.length || s.caravans.length)) {
      const top = [...s.routes].sort((a, b) => b.trips - a.trips).slice(0, 6);
      const nm = (id: number) => s.settlements.find((q) => q.id === id)?.name ?? '?';
      // Goods whose price differs most between markets: what trade moves.
      const live = s.settlements.filter((q) => !q.ruined && q.economy?.prices);
      const goods = env.resInfo
        .map((r) => {
          const ps = live.map((q) => ({ q, v: q.economy!.prices![r.id] })).filter((o) => o.v > 0);
          if (ps.length < 2) return null;
          ps.sort((a, b) => a.v - b.v);
          const avg = ps.reduce((n, o) => n + o.v, 0) / ps.length;
          return { r, avg, lo: ps[0], hi: ps[ps.length - 1], spread: ps[ps.length - 1].v / ps[0].v };
        })
        .filter((g): g is NonNullable<typeof g> => !!g && g.spread > 1.5 && live.some((q) => (q.economy!.stores[g.r.id] ?? 0) > 1))
        .sort((a, b) => b.spread - a.spread)
        .slice(0, 8);
      const fmt = (v: number) => (v >= 10 ? Math.round(v).toLocaleString() : v.toFixed(1));
      parts.push(
        h('h3', {}, 'Trade'),
        h('p', { class: 'small' }, `${s.caravans.length} caravan${s.caravans.length === 1 ? '' : 's'} on the road; ${s.routes.length} trade route${s.routes.length === 1 ? '' : 's'}. Caravans go up to about 25 days' walk; both sides must gain (barter).`),
        top.length ? h('div', { class: 'small econ-head' }, 'Busiest routes') : null,
        top.length ? h('ul', { class: 'econ-list small' }, ...top.map((r) => h('li', {}, h('span', {}, `${nm(r.a)} ↔ ${nm(r.b)}`), h('span', { class: 'num' }, `${r.trips} trips`)))) : null,
        goods.length ? h('div', { class: 'small econ-head' }, 'Prices across the markets') : null,
        goods.length
          ? h('table', { class: 'clan-table small' }, h('thead', {}, h('tr', {}, h('th', {}, 'Good'), h('th', {}, 'Cheapest'), h('th', {}, 'Dearest'))),
              h('tbody', {}, ...goods.map((g) => h('tr', {}, h('td', {}, g.r.name, h('div', { class: 'muted' }, `avg ${fmt(g.avg)}`)), h('td', { class: 'num' }, fmt(g.lo.v), h('div', { class: 'muted' }, g.lo.q.name)), h('td', { class: 'num' }, fmt(g.hi.v), h('div', { class: 'muted' }, g.hi.q.name))))))
          : null,
      );
    }

    // Cultures: each with its pillars, traditions, behaviours and people.
    const living = (s.cultures ?? []).filter((cu) => s.settlements.some((q) => !q.ruined && q.culture === cu.id) || s.tribes.some((t) => t.culture === cu.id));
    if (living.length) parts.push(h('h3', {}, 'Cultures'), ...living.map((cu) => cultureCard(cu)));

    // Faiths and the gods.
    const believed = (s.faiths ?? []).filter((f) => s.settlements.some((q) => !q.ruined && q.faith === f.id) || s.tribes.some((t) => t.faith === f.id));
    if (believed.length) parts.push(h('h3', {}, 'Faiths'), h('p', { class: 'muted small' }, 'Every people has a faith from the start: a Library faith of its culture or species, else the folk belief of its homeland. Towns are drawn to their neighbours’ and their ruler’s faith; holy places and fervour hold them.'), ...believed.map((f) => faithCard(f)));
    if (s.started) parts.push(...godsPart());

    // Technology, the world over: what is known anywhere, how widely, and who came to it first.
    if (s.started) {
      const holders = [...s.settlements.filter((q) => !q.ruined).map((q) => q.techs ?? []), ...s.clans.filter((c) => s.tribes.some((t) => t.clan === c.id)).map((c) => c.techs ?? [])];
      const count = new Map<string, number>();
      for (const list of holders) for (const id of list) count.set(id, (count.get(id) ?? 0) + 1);
      const known = L.techs.filter((t) => count.has(t.id));
      const fields = [...new Set(known.map((t) => t.field))];
      parts.push(
        h('h3', {}, 'Technology'),
        h('p', { class: 'small' }, known.length ? `${known.length} of ${L.techs.filter((t) => !t.start).length} technologies are known somewhere, among ${holders.length} settlements and roaming clans.` : 'Nothing beyond survival is known yet: peoples will discover it by living (gathering leads to farming, hunting to herding…).'),
        ...fields.map((f) => h('div', { class: 'small' },
          h('div', { class: 'econ-head' }, f),
          h('ul', { class: 'econ-list' }, ...known.filter((t) => t.field === f).map((t) => {
            const first = s.firsts?.[t.id];
            return h('li', { title: first ? `First: ${first.by}, year ${yearOf(first.day)}` : '' }, h('span', {}, t.name, first ? h('span', { class: 'muted' }, ` · first: ${first.by}, Y${yearOf(first.day)}`) : null), h('span', { class: 'num' }, `${count.get(t.id)} of ${holders.length}`));
          })),
        )),
      );
    }

    // The selected tribe
    const t = s.tribes.find((q) => q.id === selected);
    if (t) {
      const ri = raceInfo(L, t.race, t.culture);
      const clan = clanOf(t.clan);
      parts.push(
        h('h3', {}, t.name),
        h('div', { class: 'tribe-card small' },
          h('div', {}, h('span', { class: 'swatch', style: `background:${clan?.colour ?? '#888'}` }), `Clan ${clan?.name ?? '?'} · ${raceName(t.race)}`),
          cultureLine(t.culture),
          faithLine(t.faith),
          h('div', {}, `${Math.round(t.pop)} people · warband ${Math.round(t.warband)}${t.away ? ` (${Math.round(t.away)} away fighting)` : ''}`),
          s.started ? h('div', {}, `Food last month: ${Math.round(Math.min(9.99, t.fed) * 100)}% of need${t.fed < 0.8 ? ' (hungry)' : ''}`) : null,
          ri ? h('div', { class: 'muted' }, `Walks about ${Math.round(ri.speed * 0.621)} miles a day; forages and hunts about ${Math.round(ri.range * 0.621)} miles around. ${ri.lifestyle}.`) : null,
          h('div', { class: 'muted' }, 'Dashed lines: its summer (S) and winter (W) grounds.'),
        ),
        knowledgeCard({ clan: t.clan }),
        !s.started
          ? h('div', { class: 'group' },
              numberField({ label: 'People', value: Math.round(t.pop), min: 15, max: 2000, step: 5, change: (v) => { t.pop = Math.max(15, Math.min(2000, Math.round(v))); if (ri) t.warband = Math.round(t.pop * ri.warShare); d.changed(); } }),
              h('button', { type: 'button', class: 'ghost small danger', onclick: () => { removeTribe(s, t.id); selected = null; landDirty = true; d.changed(); render(); d.redraw(); } }, 'Remove this tribe'),
            )
          : null,
      );
    }
    const st = s.settlements.find((q) => q.id === selected);
    if (st) {
      const ri = raceInfo(L, st.race, st.culture);
      const clan = clanOf(st.clan);
      parts.push(
        h('h3', {}, st.name),
        h('div', { class: 'tribe-card small' },
          h('div', {}, st.kind === 'dawn' ? `Dawn city of the ${raceName(st.holyTo[0] ?? st.race)}` : 'Village'),
          st.holyTo.length ? h('div', { class: 'holy-tag' }, `Holy to all the ${st.holyTo.map(raceName).join(', ')}, wherever they are${st.ruined ? ', even in ruin' : ''}.`) : null,
          st.ruined
            ? h('div', {}, 'In ruins. Those who come to it may build it again (its own people most of all).')
            : h('div', {}, h('span', { class: 'swatch', style: `background:${clan?.colour ?? '#888'}` }), h('span', { class: 'link', onclick: () => { if (clan) { selectedRealm = clan.id; selected = null; render(); d.redraw(); } } }, clan ? realmName(L, clan) : '?'), ` · ${raceName(st.race)}`),
          !st.ruined && clan?.realm && s.started
            ? h('div', {}, clan.realm.capital === st.id ? `The capital, seat of ${rulerTitle(L, clan)} ${clan.realm.ruler.name}.` : `Its realm's hold here: ${Math.round((st.control ?? 0) * 100)}%`, clan.realm.capital === st.id ? null : h('span', { class: 'muted' }, ' (from the days an order takes to come from the capital, and the realm’s centralization)'))
            : null,
          !st.ruined && st.occupied
            ? h('div', { class: 'warn' }, `Held by ${clanOf(st.occupied.by) ? realmName(L, clanOf(st.occupied.by)!) : '?'} since year ${yearOf(st.occupied.since)} (a garrison of ${Math.round(st.occupied.garrison)}).`)
            : null,
          !st.ruined ? h('div', { class: 'muted' }, `Walls: ${WALL_NAMES[wallLevel(L, st, clan?.realm?.capital === st.id)]}.`) : null,
          !st.ruined && st.besieged
            ? (() => {
                const by = (s.armies ?? []).find((q) => q.id === st.besieged!.by);
                return h('div', { class: 'warn' }, `Under siege by the ${by?.name ?? 'enemy'} for ${s.day - st.besieged!.since} days${by?.siege?.breach ? `; walls ${Math.round(by.siege.breach * 100)}% breached` : ''}. Only the fields within the walls are worked, and no caravans go out.`);
              })()
            : null,
          !st.ruined && st.prince ? h('div', {}, `Ruled for its realm by the high prince of the house of ${st.prince} (its old ruling line).`) : null,
          !st.ruined && st.claimedBy?.some((q) => clanOf(q)) ? h('div', { class: 'muted' }, `Claimed by ${st.claimedBy.map((q) => clanOf(q)).filter((q): q is Clan => !!q).map((q) => realmName(L, q)).join(', ')} (who once held it).`) : null,
          !st.ruined && s.started && st.loyalty !== undefined && clan?.realm?.capital !== st.id
            ? h('div', {}, `Loyalty: ${Math.round(st.loyalty * 100)}%${st.unrest ? `, discontented for ${st.unrest} year${st.unrest === 1 ? '' : 's'}` : ''}`)
            : null,
          st.ruined ? null : cultureLine(st.culture),
          st.ruined ? null : faithLine(st.faith, st.faithShift),
          !st.ruined && st.cultureShift ? h('div', { class: 'muted' }, `Being drawn into the ways of the ${cultureOf(s, st.cultureShift.to)?.name ?? '?'} (${Math.round(st.cultureShift.progress * 100)}%).`) : null,
          st.ruined ? null : h('div', {}, `${Math.round(st.pop)} people · ${Math.round(st.warband)} to guard it`),
          s.started && !st.ruined ? h('div', {}, `Food last month: ${Math.round(Math.min(9.99, st.fed) * 100)}% of need${st.fed < 0.8 ? ' (hungry)' : ''}`) : null,
          ri && !st.ruined ? h('div', { class: 'muted' }, `Works the land about ${Math.round(ri.range * (st.kind === 'dawn' ? 2.2 : 1.5) * 0.621)} miles around. When it fills up it sends people out: new tribes, or villages nearby.`) : null,
        ),
        !st.ruined && st.economy && ri ? economyCard(st, ri.need) : null,
        !st.ruined ? knowledgeCard({ st }) : null,
        !st.ruined && st.economy ? waysCard(st) : null,
        !s.started
          ? h('div', { class: 'group' },
              numberField({ label: 'People', value: Math.round(st.pop), min: 30, max: 20000, step: 10, change: (v) => { st.pop = Math.max(30, Math.min(20000, Math.round(v))); if (ri) st.warband = Math.round(st.pop * ri.warShare * 0.6); const row = draft.get(st.race); if (row) row.cityPop = st.pop; d.changed(); } }),
              h('button', { type: 'button', class: 'ghost small danger', onclick: () => { removeSettlement(s, st.id); selected = null; landDirty = true; d.changed(); render(); d.redraw(); } }, 'Remove this dawn city'),
            )
          : null,
      );
    }
    parts.push(h('h3', {}, 'Show on the map'), display);

    if (s.started) {
      const ev = s.events.slice(-60).reverse();
      parts.push(
        h('h3', {}, 'What has happened'),
        ev.length
          ? h('ul', { class: 'event-log small' }, ...ev.map((e) => h('li', {}, h('span', { class: 'muted' }, `Y${yearOf(e.day)} M${monthOf(e.day) + 1}: `), e.text)))
          : h('p', { class: 'muted small' }, 'Nothing of note yet.'),
      );
      const reset = h('div', { class: 'danger-zone' });
      const idle = () => reset.replaceChildren(h('button', { type: 'button', class: 'ghost danger small', onclick: ask }, 'Start over…'));
      const ask = () =>
        reset.replaceChildren(
          h('span', { class: 'small' }, 'Clear the peoples and their history, back to choosing who takes part?'),
          h('button', { type: 'button', class: 'danger-solid', onclick: () => {
            play(false);
            const setup = s.setup;
            sim = newSim(env!, d.world().settings.seed);
            sim.setup = setup;
            draft.clear();
            selected = null;
            landDirty = beastDirty = true;
            d.changed();
            render();
            d.redraw();
          } }, 'Start over'),
          h('button', { type: 'button', class: 'ghost', onclick: idle }, 'Keep'),
        );
      idle();
      parts.push(reset);
    }
    panel.replaceChildren(...(parts.filter(Boolean) as HTMLElement[]));
  };
  /** What the resource panel shows: the selected settlement (or its realm, for a tribe), or the selected realm. */
  let landCache: { key: string; land: Record<string, number> } | null = null;
  function resourceView(): ResourceView | null {
    const s = sim;
    const e = env;
    if (!s || !e) return null;
    const info = (id: string) => {
      const r = resInfoOf(e, id);
      return r ? { name: r.name, category: r.category } : undefined;
    };
    const landOf = (key: string, cells: () => number[]): Record<string, number> => {
      if (landCache?.key === key) return landCache.land;
      const land: Record<string, number> = {};
      for (const k of cells()) for (const r of e.resInfo) {
        const v = e.res[r.id]?.[k] ?? 0;
        if (v > (land[r.id] ?? 0)) land[r.id] = v;
      }
      landCache = { key, land };
      return land;
    };
    const st = s.settlements.find((q) => q.id === selected && !q.ruined);
    if (st) {
      const ri = raceInfo(lib(), st.race, st.culture, s.cultures);
      const r = (ri?.range ?? 22) * (st.kind === 'dawn' ? 2.2 : 1.5);
      const cells = () => {
        const out: number[] = [];
        const n = Math.ceil(r / e.step);
        const ci = Math.round((st.x - e.x0) / e.step);
        const cj = Math.round((st.y - e.y0) / e.step);
        for (let dj = -n; dj <= n; dj++) for (let di = -n; di <= n; di++) {
          const j = cj + dj;
          const i = ((ci + di) % e.w + e.w) % e.w;
          if (j < 0 || j >= e.h || di * di + dj * dj > n * n) continue;
          if (e.land[j * e.w + i]) out.push(j * e.w + i);
        }
        return out;
      };
      return { kind: 'Settlement', name: st.name, stores: { ...(st.economy?.stores ?? {}) }, land: landOf(`s${st.id}`, cells), info };
    }
    const tribe = s.tribes.find((q) => q.id === selected);
    const clan = clanOf(selectedRealm ?? tribe?.clan ?? -1);
    if (!clan) return null;
    const stores: Record<string, number> = {};
    for (const q of s.settlements) if (!q.ruined && q.clan === clan.id) for (const [id, v] of Object.entries(q.economy?.stores ?? {})) stores[id] = (stores[id] ?? 0) + v;
    const cells = () => {
      const out: number[] = [];
      for (let k = 0; k < e.n; k++) if (s.owner[k] === clan.id) out.push(k);
      return out;
    };
    return { kind: 'Realm', name: realmName(lib(), clan), stores, land: landOf(`r${clan.id}:${Math.floor(s.day / 360)}`, cells), info };
  }
  render();

  return {
    panel,
    bar,
    overlay,
    setActive(on) {
      active = on;
      if (on) render();
      updateBar();
      d.redraw();
    },
    climateChanged,
    pack: () => (sim && env && !gridProblem && (sim.tribes.length || sim.settlements.length || sim.started) ? packSim(sim, env) : pending),
    resources: resourceView,
    dispose() {
      playing = false;
      cancelAnimationFrame(frame);
      clearTimeout(panelTimer);
    },
  };
}
