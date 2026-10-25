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
import type { Clan, LiveCulture } from '../sim/state';
import { govOf, preferredGov, realmName, rulerTitle } from '../sim/nations';
import { techTiers } from '../core/library';
import { dateText, DAYS_PER_MONTH, monthOf, northernSummer, yearOf, type Settlement, type SetupRow, type SimState, type StartKind, type Tribe } from '../sim/state';
import { choice, h, numberField, toast } from './dom';
import type { MapOverlay } from './mapview';

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
  dispose(): void;
}

const SPEEDS = [
  { value: '1', label: 'Day/s', days: 1 },
  { value: '7', label: 'Week/s', days: 7 },
  { value: '30', label: 'Month/s', days: 30 },
  { value: '360', label: 'Year/s', days: 360 },
];
const SQ_MI = 0.386102;

export function createPeoples(d: PeoplesDeps): Peoples {
  let env: Env | null = null;
  let sim: SimState | null = null;
  let pending: PackedSim | null = d.world().sim ?? null;
  let gridProblem = false;
  let active = false;
  let selected: number | null = null;
  /** The realm (clan id) whose card is open. */
  let selectedRealm: number | null = null;
  let mode: 'select' | 'add' = 'select';
  let addRace = '';
  let addWhat: 'tribe' | 'dawn' = 'tribe';
  let addClan: 'new' | 'selected' = 'new';
  let showLand = true;
  let showBeast = '';
  let showRes = '';
  let showTrade = true;
  let showWays = true;
  let landsBy: 'clan' | 'culture' = 'clan';
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
  const speedSeg = choice('Speed', SPEEDS.map(({ value, label }) => ({ value, label })), String(speed), (v) => {
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
      return [c.id, hex(cu ? cultureColour(s, cu) : c.colour)];
    }));
    return fieldImage((data) => {
      for (let k = 0; k < e.n; k++) {
        const o = s.owner[k];
        if (o < 0 || !e.land[k]) continue;
        const c = colours.get(o) ?? [128, 128, 128];
        const i = k % e.w;
        const j = (k / e.w) | 0;
        // Borders: next to land that is someone else's (or no one's).
        const nb = [i > 0 ? k - 1 : e.wrapKm ? k + e.w - 1 : -1, i < e.w - 1 ? k + 1 : e.wrapKm ? k - e.w + 1 : -1, j > 0 ? k - e.w : -1, j < e.h - 1 ? k + e.w : -1];
        const edge = nb.some((m) => m >= 0 && e.land[m] && s.owner[m] !== o);
        // Land being taken over: lighter.
        const contested = s.rival[k] >= 0 && s.rivalUse[k] > 0;
        data.set([c[0], c[1], c[2], edge ? 225 : contested ? 70 : 130], k * 4);
      }
    });
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
      const blit = (img: HTMLCanvasElement) => {
        g.save();
        g.imageSmoothingEnabled = true;
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
        if (landDirty || !landImg) landImg = drawLand();
        landDirty = false;
        blit(landImg);
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
    describe(x, y) {
      if (!ready()) return null;
      const s = sim!;
      const out: string[] = [];
      const t = tribeAt(x, y, pxKm);
      if (t) out.push(`${t.name} (clan ${clanOf(t.clan)?.name ?? '?'}): ${Math.round(t.pop)} people, ${Math.round(Math.min(1, t.fed) * 100)}% fed`);
      const st = t ? null : settlementAt(x, y, pxKm);
      if (st) out.push(settlementLine(st));
      if (showTrade) for (const cv of s.caravans) {
        let dx = Math.abs(cv.x - x);
        if (env!.wrapKm) dx = Math.min(dx, env!.wrapKm - dx);
        if (Math.hypot(dx, cv.y - y) > 8 * pxKm) continue;
        const from = s.settlements.find((q) => q.id === cv.from)?.name ?? '?';
        const to = s.settlements.find((q) => q.id === cv.to)?.name ?? '?';
        const goods = Object.entries(cv.cargo).map(([id, u]) => `${Math.round(u)} ${resInfoOf(env!, id)?.name.toLowerCase() ?? id}`).join(', ');
        out.push(`${cv.train ? 'Train' : 'Caravan'} of ${from} (${cv.people} people${cv.animals ? `, ${cv.animals} pack animals` : ''}) ${cv.leg === 'out' ? `going to ${to}` : `coming home from ${to}`}${goods ? `, carrying ${goods}` : ''}`);
        break;
      }
      const k = cellOf(x, y);
      if (k >= 0 && env!.land[k]) {
        const o = s.owner[k];
        if (o >= 0) out.push(`Land of clan ${clanOf(o)?.name ?? '(gone)'}${s.rival[k] >= 0 && s.rivalUse[k] > 0 ? `, being taken by clan ${clanOf(s.rival[k])?.name ?? '?'}` : ''}`);
        if (s.way[k]) {
          const keeper = s.settlements.find((q) => q.id === s.wayKeeper[k]);
          out.push(`${WAYS[s.way[k]].name}${keeper ? ` (kept by ${keeper.name})` : s.way[k] === 1 ? ' (worn by use)' : ''}`);
        }
        if (showRes) {
          const r = env!.resInfo.find((q) => q.id === showRes);
          if (r) out.push(env!.res[r.id][k] > 0.01 ? `${r.name} here (${Math.round(Math.min(1, env!.res[r.id][k]) * 100)}%)` : `No ${r.name.toLowerCase()} here`);
        }
        if (showBeast) {
          const b = env!.beastInfo.find((q) => q.id === showBeast);
          if (b) out.push(`${b.name}: ${Math.round((s.beasts[b.id][k] / Math.max(1e-6, env!.beastK[b.id][k] || 1)) * 100)}% of what the land carries`);
        }
      }
      return out.length ? out.join(' · ') : null;
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
      r ? h('div', {}, `${rulerTitle(L, cn)} ${r.ruler.name} of the house of ${r.ruler.house}, ${age} years old, ruling since year ${yearOf(r.ruler.since)}${r.reigns > 1 ? ` (reign ${r.reigns} of this realm)` : ''}.`) : null,
      h('div', {}, capital ? `Capital: ${capital.name}. ` : 'No capital: its tribes move with the seasons. ', `${towns.length} town${towns.length === 1 ? '' : 's'}, ${tribes.length} tribe${tribes.length === 1 ? '' : 's'}.`),
      g ? h('div', { class: 'econ-head' }, `Government: ${g.name}${r ? ` (since year ${yearOf(r.since)})` : ''}`) : null,
      g ? h('ul', { class: 'econ-list' }, part('Head', g.head), part('Ruling class', g.ruling), part('Land held by', g.land), part('Succession', g.succession), part('Legitimacy', g.legitimacy), part('Army', g.army), part('Law', g.law)) : null,
      h('div', { class: 'muted' }, pg ? `Its culture prefers: ${pg.name}${pref.hold ? ` (${pref.hold.toLowerCase()})` : ' (free to change)'}.` : 'Its culture has no preferred government: its conditions lead it (size, way of life, trade, the ways of rule it has learned).'),
      r ? h('div', {}, `Centralization: ${pct(r.centralization)}`, h('span', { class: 'muted' }, ' — how far its orders are felt; raised by writing, records, taxes, riders and roads.')) : null,
      towns.length > 1 ? h('div', { class: 'econ-head' }, 'How firmly it holds its towns') : null,
      towns.length > 1 ? h('ul', { class: 'econ-list' }, ...towns.slice(0, 12).map((q) => h('li', { class: 'clickable', onclick: () => { selected = q.id; selectedRealm = null; render(); d.redraw(); } }, h('span', {}, q.name, q.id === r?.capital ? h('span', { class: 'muted' }, ' (capital)') : null, q.culture !== cn.culture && cultureOf(s, q.culture) ? h('span', { class: 'muted' }, ` · ${cultureOf(s, q.culture)!.name}`) : null), h('span', { class: 'num' }, pct(q.control ?? 0))))) : null,
      towns.length > 12 ? h('div', { class: 'muted' }, `…and ${towns.length - 12} more.`) : null,
    );
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
    return `${st.name} (${what}${cn?.realm?.capital === st.id ? ', capital' : ''}, ${cn ? realmName(lib(), cn) : '?'}): ${Math.round(st.pop)} people, ${Math.round(Math.min(1, st.fed) * 100)}% fed${st.holyTo.length ? `; holy to the ${st.holyTo.map(raceName).join(', ')}` : ''}`;
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
      choice<'clan' | 'culture'>('Colour lands by', [{ value: 'clan', label: 'Clan' }, { value: 'culture', label: 'Culture' }], landsBy, (v) => { landsBy = v; landDirty = true; d.redraw(); render(); }),
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
          st.ruined ? null : cultureLine(st.culture),
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
    dispose() {
      playing = false;
      cancelAnimationFrame(frame);
      clearTimeout(panelTimer);
    },
  };
}
