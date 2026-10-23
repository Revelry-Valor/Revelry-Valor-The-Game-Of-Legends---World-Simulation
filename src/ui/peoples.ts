import type { Climate } from '../core/climate';
import { raceMissing, type Library } from '../core/library';
import type { Surface } from '../core/paint';
import type { World } from '../core/world';
import { buildEnv, type Env } from '../sim/env';
import { packSim, unpackSim, type PackedSim } from '../sim/pack';
import { addTribe, clanLand, eligibleRaces, moveTribe, newSim, placeStart, raceInfo, removeTribe, stepDays } from '../sim/sim';
import { dateText, DAYS_PER_MONTH, monthOf, northernSummer, yearOf, type SimState, type Tribe } from '../sim/state';
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
  let mode: 'select' | 'add' = 'select';
  let addRace = '';
  let addClan: 'new' | 'selected' = 'new';
  let showLand = true;
  let showBeast = '';
  let follow = true;
  let playing = false;
  let speed = 30;
  let busy = false;
  let pxKm = 1;
  const draft = new Map<string, number>();

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
    if (selected !== null && !sim.tribes.some((t) => t.id === selected)) selected = null;
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
      if (!sim.tribes.length) {
        playing = false;
        toast('No peoples are left.');
        updateBar();
        return;
      }
    }
    frame = requestAnimationFrame(tick);
  };
  const play = (on: boolean) => {
    if (!ready() || !sim!.tribes.length) {
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
    if (!ready() || busy || !sim!.tribes.length) return;
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
      if (left > 0 && sim!.tribes.length) window.setTimeout(slice, 0);
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
    const has = ready() && !!sim!.tribes.length;
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
    const colours = new Map(s.clans.map((c) => [c.id, hex(c.colour)]));
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
        // Warbands away: a diamond, with a line to where they are going.
        for (const so of s.sorties) {
          const [sx, sy] = at(so.x, so.y, c);
          const goal = s.tribes.find((t) => t.id === (so.leg === 'out' ? so.target : so.tribe));
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
      if (mode === 'add' && !hit) {
        if (!addRace) {
          toast('Choose which race to add first.');
          return true;
        }
        const k = cellOf(x, y);
        if (k < 0 || !env!.land[k]) {
          toast('Tribes are placed on land.');
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
      selected = hit?.id ?? null;
      render();
      d.redraw();
      if (hit && !s.started) {
        dragging = hit;
        return true;
      }
      return !!hit;
    },
    drag(x, y) {
      if (!dragging) return;
      dragging.x = x;
      dragging.y = y;
    },
    up(x, y) {
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
      const k = cellOf(x, y);
      if (k >= 0 && env!.land[k]) {
        const o = s.owner[k];
        if (o >= 0) out.push(`Land of clan ${clanOf(o)?.name ?? '(gone)'}${s.rival[k] >= 0 && s.rivalUse[k] > 0 ? `, being taken by clan ${clanOf(s.rival[k])?.name ?? '?'}` : ''}`);
        if (showBeast) {
          const b = env!.beastInfo.find((q) => q.id === showBeast);
          if (b) out.push(`${b.name}: ${Math.round((s.beasts[b.id][k] / Math.max(1e-6, env!.beastK[b.id][k] || 1)) * 100)}% of what the land carries`);
        }
      }
      return out.length ? out.join(' · ') : null;
    },
  };
  let dragging: Tribe | null = null;
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
      h('div', { class: 'field' }, h('label', {}, 'Where beasts live'), beastSelect, h('small', {}, 'Yellow is few, red is many: as many as the land can carry, thinned where they are hunted.')),
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
      if (!draft.size) for (const r of s.setup.length ? s.setup : ok.map((o) => ({ race: o.race.id, tribes: 6 }))) draft.set(r.race, r.tribes);
      if (!addRace || !ok.some((o) => o.race.id === addRace)) addRace = ok[0].race.id;
      const rows = ok.map(({ race }) => {
        const n = draft.get(race.id) ?? 0;
        return h('tr', {},
          h('td', {}, h('label', { class: 'field-row small' }, h('input', { type: 'checkbox', checked: n > 0, onchange: (e: Event) => { draft.set(race.id, (e.target as HTMLInputElement).checked ? 6 : 0); render(); } }), raceName(race.id))),
          h('td', {}, h('input', { type: 'number', min: 0, max: 40, step: 1, value: String(n), 'aria-label': `Tribes of ${race.name}`, onchange: (e: Event) => { draft.set(race.id, Math.max(0, Math.min(40, Math.round(Number((e.target as HTMLInputElement).value) || 0)))); } })),
        );
      });
      parts.push(
        h('p', { class: 'muted small' }, 'Choose who takes part and how many tribes each starts with. They are placed where their land suits them best; then drag a tribe to move it, or add and remove tribes. Press Play (above the map) to begin.'),
        h('table', { class: 'race-pick small' }, h('thead', {}, h('tr', {}, h('th', {}, 'Race'), h('th', {}, 'Tribes'))), h('tbody', {}, ...rows)),
        incomplete.length ? h('p', { class: 'muted small' }, `${incomplete.length} more races can take part once they are complete in the Library.`, ' ', h('button', { type: 'button', class: 'ghost small', onclick: d.openLibrary }, 'Library')) : null,
        h('button', { type: 'button', class: 'primary', onclick: () => {
          if (d.climateBusy()) {
            toast('The climate is still being worked out after your last change. Place them in a moment, once it is done.');
            return;
          }
          const setup = [...draft].filter(([, n]) => n > 0).map(([race, tribes]) => ({ race, tribes }));
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
          toast(s.tribes.length ? `Placed ${s.tribes.length} tribes in ${s.clans.length} clans.` : 'No land here suits them: paint some land first, or check the races’ climates in the Library.');
        } }, s.tribes.length ? 'Place again automatically' : 'Place automatically'),
        h('h3', {}, 'On the map'),
        choice<'select' | 'add'>('Map tool', [{ value: 'select', label: 'Select & move' }, { value: 'add', label: 'Add a tribe' }], mode, (v) => { mode = v; render(); }),
        mode === 'add'
          ? h('div', { class: 'group' },
              h('div', { class: 'field' }, h('label', {}, 'Race'), h('select', { onchange: (e: Event) => { addRace = (e.target as HTMLSelectElement).value; } }, ...ok.map((o) => h('option', { value: o.race.id, selected: o.race.id === addRace }, raceName(o.race.id))))),
              choice<'new' | 'selected'>('Clan', [{ value: 'new', label: 'A new clan' }, { value: 'selected', label: 'The selected tribe’s clan', disabled: selected === null }], addClan, (v) => { addClan = v; }),
              h('p', { class: 'muted small' }, 'Click the map to place a tribe there.'),
            )
          : h('p', { class: 'muted small' }, 'Click a tribe to see it; drag it to move it (its summer and winter grounds move with it).'),
      );
    } else {
      // Running: how things stand.
      const people = s.tribes.reduce((n, t) => n + t.pop, 0);
      const land = clanLand(s, env);
      parts.push(
        h('p', { class: 'summary' }, `${dateText(s.day)}\n${s.tribes.length} tribes in ${s.clans.length} clans, ${Math.round(people).toLocaleString()} people`),
      );
      const clanRows = [...s.clans]
        .map((cn) => ({ cn, tribes: s.tribes.filter((t) => t.clan === cn.id) }))
        .sort((a, b) => b.tribes.reduce((n, t) => n + t.pop, 0) - a.tribes.reduce((n, t) => n + t.pop, 0))
        .map(({ cn, tribes }) =>
          h('tr', {},
            h('td', {}, h('span', { class: 'swatch', style: `background:${cn.colour}` }), cn.name),
            h('td', { title: raceName(cn.race) }, raceName(cn.race).replace(/ \(.*\)$/, '')),
            h('td', { class: 'num' }, String(tribes.length)),
            h('td', { class: 'num' }, Math.round(tribes.reduce((n, t) => n + t.pop, 0)).toLocaleString()),
            h('td', { class: 'num' }, Math.round((land.get(cn.id) ?? 0) * SQ_MI).toLocaleString()),
          ),
        );
      parts.push(
        h('h3', {}, 'Clans'),
        h('div', { class: 'table-scroll' }, h('table', { class: 'clan-table small' }, h('thead', {}, h('tr', {}, h('th', {}, 'Clan'), h('th', {}, 'Race'), h('th', {}, 'Tribes'), h('th', {}, 'People'), h('th', {}, 'Land (sq mi)'))), h('tbody', {}, ...clanRows))),
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
          h('div', {}, `${Math.round(t.pop)} people · warband ${Math.round(t.warband)}${t.away ? ` (${Math.round(t.away)} away fighting)` : ''}`),
          s.started ? h('div', {}, `Food last month: ${Math.round(Math.min(9.99, t.fed) * 100)}% of need${t.fed < 0.8 ? ' (hungry)' : ''}`) : null,
          ri ? h('div', { class: 'muted' }, `Walks about ${Math.round(ri.speed * 0.621)} miles a day; forages and hunts about ${Math.round(ri.range * 0.621)} miles around. ${ri.lifestyle}.`) : null,
          h('div', { class: 'muted' }, 'Dashed lines: its summer (S) and winter (W) grounds.'),
        ),
        !s.started
          ? h('div', { class: 'group' },
              numberField({ label: 'People', value: Math.round(t.pop), min: 15, max: 2000, step: 5, change: (v) => { t.pop = Math.max(15, Math.min(2000, Math.round(v))); if (ri) t.warband = Math.round(t.pop * ri.warShare); d.changed(); } }),
              h('button', { type: 'button', class: 'ghost small danger', onclick: () => { removeTribe(s, t.id); selected = null; landDirty = true; d.changed(); render(); d.redraw(); } }, 'Remove this tribe'),
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
    pack: () => (sim && env && !gridProblem && (sim.tribes.length || sim.started) ? packSim(sim, env) : pending),
    dispose() {
      playing = false;
      cancelAnimationFrame(frame);
      clearTimeout(panelTimer);
    },
  };
}
