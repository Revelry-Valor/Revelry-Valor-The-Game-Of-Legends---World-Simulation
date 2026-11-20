import type { Library } from '../core/library';
import type { LineageEvent, Track } from '../sim/history';
import { yearOf, type LiveCulture, type SimState } from '../sim/state';
import { bundleOf, levelOf, rootOf } from '../sim/traits';
import { h } from './dom';

/**
 * The history of peoples (REDESIGN.md, "Cultures as peoples", step 7): cultures, languages, and
 * races and subraces as lines over time, left to right. Main lines thick, subcultures and dialects
 * thin, each thickening and thinning with its people; children beside their parent, a blend
 * between its parents; lanes freed by a line that ended are used again. Splits and blends drawn as
 * connectors from the parent lines, absorption as a curve into the absorber, extinction as an end
 * cap, a dialect grown into a language as its line thickening, a change of faith or tongue as a
 * diamond. Coloured by family.
 *
 * Zoom (wheel) and pan (drag) along time; hide subcultures; filter by family or realm; hover a
 * line to light its ancestry and descendants; click it for its panel (its traits, people over
 * time, what happened to it, and its tongue and races in the other tabs); scrub a date to show
 * the map's cultures at that moment.
 */

export interface TimelineDeps {
  sim(): SimState | null;
  lib(): Library;
  cultureColour(cu: LiveCulture): string;
  /** Show the map's cultures as they were on a day (null: as they are now). */
  scrub(day: number | null): void;
}

interface Line {
  id: string;
  name: string;
  sub: boolean;
  /** When a thin line became a main one (a dialect grown into a language). */
  promoted?: number;
  parents: string[];
  family: string;
  start: number;
  end?: number;
  series: [number, number][];
  events: LineageEvent[];
  lane: number;
  colour: string;
}

const LANE = 22;
const TOP = 10;
const AXIS = 26;
const hue = (s: string) => {
  let x = 0;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360;
  return x;
};

/** The lines of one track, from the sim's history. */
function linesOf(sim: SimState, lib: Library, track: Track, colour: (cu: LiveCulture) => string): Line[] {
  const hist = sim.history;
  const snaps = hist?.snaps ?? [];
  const evs = hist?.events ?? [];
  const seriesOf = (pick: (s: (typeof snaps)[number]) => Record<string, number>, id: string): [number, number][] => snaps.map((s) => [s.day, pick(s)[id] ?? 0]);
  const now = sim.day;
  const first = snaps[0]?.day ?? now;
  if (track === 'culture') {
    const all = sim.cultures ?? [];
    return all
      .filter((cu) => snaps.some((s) => (s.cultures[cu.id] ?? 0) > 0))
      .map((cu) => {
        const fam = rootOf(all, cu);
        const base = hue(fam.id);
        return {
          id: cu.id,
          name: cu.name,
          sub: levelOf(cu) === 'subculture',
          parents: cu.blend?.length ? [...cu.blend] : cu.parent ? [cu.parent] : [],
          family: fam.id,
          start: Math.max(first, cu.founded),
          ...(cu.ended !== undefined ? { end: cu.ended } : {}),
          series: seriesOf((s) => s.cultures, cu.id),
          events: evs.filter((e) => e.track === 'culture' && e.id === cu.id),
          lane: 0,
          colour: fam === cu ? colour(cu) : `hsl(${base}, 45%, ${40 + (hue(cu.id) % 20)}%)`,
        };
      });
  }
  if (track === 'language') {
    const langs = sim.languages ?? [];
    const rootL = (id: string) => {
      let l = langs.find((q) => q.id === id);
      for (let i = 0; i < 30 && l?.parent; i++) {
        const up = langs.find((q) => q.id === l!.parent);
        if (!up) break;
        l = up;
      }
      return l?.id ?? id;
    };
    return langs
      .filter((l) => snaps.some((s) => (s.languages[l.id] ?? 0) > 0))
      .map((l) => {
        const fam = rootL(l.id);
        const promoted = evs.find((e) => e.track === 'language' && e.id === l.id && e.kind === 'promoted')?.day;
        return {
          id: l.id,
          name: l.name,
          sub: l.kind === 'dialect' || promoted !== undefined,
          ...(promoted !== undefined ? { promoted } : {}),
          parents: l.parents?.length ? [...l.parents] : l.parent ? [l.parent] : [],
          family: fam,
          start: Math.max(first, l.founded),
          ...(l.ended !== undefined ? { end: l.ended } : {}),
          series: seriesOf((s) => s.languages, l.id),
          events: evs.filter((e) => e.track === 'language' && e.id === l.id),
          lane: 0,
          colour: `hsl(${hue(fam)}, 50%, ${38 + (hue(l.id) % 22)}%)`,
        };
      });
  }
  // Races: by species (the family), the species' first race its main line, the others its subraces.
  const out: Line[] = [];
  for (const sp of lib.species) {
    sp.races.forEach((r, i) => {
      const series = seriesOf((s) => s.races, r.id);
      if (!series.some(([, n]) => n > 0)) return;
      const firstDay = series.find(([, n]) => n > 0)![0];
      const ext = evs.filter((e) => e.track === 'race' && e.id === r.id && e.kind === 'extinct').pop();
      const back = ext && series.some(([d, n]) => d > ext.day && n > 0);
      out.push({
        id: r.id,
        name: r.name,
        sub: i > 0,
        parents: i > 0 && sp.races[0] && out.some((q) => q.id === sp.races[0].id) ? [sp.races[0].id] : [],
        family: sp.id,
        start: firstDay,
        ...(ext && !back ? { end: ext.day } : {}),
        series,
        events: evs.filter((e) => e.track === 'race' && e.id === r.id),
        lane: 0,
        colour: `hsl(${hue(sp.id)}, 45%, ${38 + i * 8}%)`,
      });
    });
  }
  return out;
}

/** Lanes: tree order (children after their parent, a blend after its first parent), each in the nearest lane to its parent free over its life. */
function layout(lines: Line[], now: number): number {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const kids = new Map<string, Line[]>();
  const roots: Line[] = [];
  for (const l of lines) {
    const p = l.parents.find((q) => byId.has(q));
    if (p) kids.set(p, [...(kids.get(p) ?? []), l]);
    else roots.push(l);
  }
  const order: Line[] = [];
  const walk = (l: Line) => {
    order.push(l);
    for (const k of (kids.get(l.id) ?? []).sort((a, b) => a.start - b.start)) walk(k);
  };
  for (const r of roots.sort((a, b) => a.start - b.start)) walk(r);
  const lanes: [number, number][][] = [];
  const free = (i: number, a: number, b: number) => (lanes[i] ?? []).every(([x, y]) => b + 360 * 3 < x || a > y + 360 * 3);
  for (const l of order) {
    const a = l.start;
    const b = l.end ?? now;
    const parent = l.parents.map((q) => byId.get(q)).find((q) => q);
    const from = parent ? parent.lane + 1 : 0;
    let lane = -1;
    for (let i = from; i < lanes.length + 1 && lane < 0; i++) if (free(i, a, b)) lane = i;
    if (lane < 0) lane = lanes.length;
    (lanes[lane] ??= []).push([a, b]);
    l.lane = lane;
  }
  return lanes.length;
}

/** Open the history of peoples (a panel docked at the bottom, the map left in view above it). */
export function openTimeline(d: TimelineDeps): void {
  const sim = d.sim();
  if (!sim) return;
  document.querySelector('.timeline-dialog')?.remove();
  let track: Track = 'culture';
  let showSubs = true;
  let family = '';
  let realm = -1;
  let hover: Line | null = null;
  let picked: Line | null = null;
  let scrubDay: number | null = null;
  let onMap = false;
  let view: [number, number] = [0, 1];
  let lines: Line[] = [];
  let lanes = 0;

  const canvas = h('canvas', { class: 'timeline-canvas', 'aria-label': 'Timeline of peoples' }) as HTMLCanvasElement;
  const side = h('div', { class: 'timeline-side' });
  const tabs = h('div', { class: 'timeline-tabs', role: 'tablist' });
  const subsBox = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const famSel = h('select', { 'aria-label': 'Family' }) as HTMLSelectElement;
  const realmSel = h('select', { 'aria-label': 'Realm' }) as HTMLSelectElement;
  const slider = h('input', { type: 'range', min: 0, max: 1000, value: 1000, 'aria-label': 'Date' }) as HTMLInputElement;
  const sliderLabel = h('span', { class: 'muted small' });
  const mapBox = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const dialog = h('dialog', { class: 'dialog timeline-dialog' },
    h('div', { class: 'timeline-head' },
      h('strong', {}, 'History of peoples'),
      tabs,
      h('label', { class: 'small' }, subsBox, ' Subcultures and dialects'),
      famSel,
      realmSel,
      h('button', { type: 'button', class: 'ghost small', onclick: () => fit() }, 'Fit'),
      h('button', { type: 'button', class: 'ghost small', onclick: () => close() }, 'Close'),
    ),
    h('div', { class: 'timeline-body' }, h('div', { class: 'timeline-wrap' }, canvas), side),
    h('div', { class: 'timeline-foot' }, h('span', { class: 'small' }, 'Date'), slider, sliderLabel, h('label', { class: 'small' }, mapBox, ' Show the map’s cultures at this date')),
  );
  document.body.append(dialog);

  const close = () => {
    d.scrub(null);
    dialog.close();
    dialog.remove();
  };
  const range = () => {
    const snaps = sim.history?.snaps ?? [];
    const a = Math.min(snaps[0]?.day ?? sim.day, ...lines.map((l) => l.start));
    return [a, Math.max(sim.day, a + 360 * 10)] as [number, number];
  };
  const fit = () => {
    view = range();
    draw();
  };
  const visible = (l: Line) => (showSubs || !l.sub) && (!family || l.family === family) && (realm < 0 || inRealm.has(l.id));
  let inRealm = new Set<string>();
  const rebuild = () => {
    lines = linesOf(sim, d.lib(), track, d.cultureColour).filter(visible);
    lanes = layout(lines, sim.day);
    // Families and realms to filter by.
    const fams = new Map<string, string>();
    for (const l of linesOf(sim, d.lib(), track, d.cultureColour)) {
      const root = track === 'culture' ? sim.cultures?.find((c) => c.id === l.family)?.name : track === 'language' ? sim.languages?.find((q) => q.id === l.family)?.name : d.lib().species.find((s) => s.id === l.family)?.name;
      fams.set(l.family, root ?? l.family);
    }
    famSel.replaceChildren(h('option', { value: '' }, 'Every family'), ...[...fams].map(([id, n]) => h('option', { value: id }, `The ${n} family`)));
    famSel.value = fams.has(family) ? family : '';
    const realms = sim.clans.filter((c) => c.realm && sim.settlements.some((s) => !s.ruined && s.clan === c.id));
    realmSel.replaceChildren(h('option', { value: '-1' }, 'Every realm'), ...realms.map((c) => h('option', { value: String(c.id) }, c.name)));
    realmSel.value = String(realm);
    tabs.replaceChildren(
      ...(['culture', 'language', 'race'] as Track[]).map((t) => h('button', { type: 'button', role: 'tab', class: `ghost small${t === track ? ' on' : ''}`, 'aria-selected': t === track ? 'true' : 'false', onclick: () => setTrack(t) }, t === 'culture' ? 'Cultures' : t === 'language' ? 'Languages' : 'Races and subraces')),
    );
    draw();
  };
  const computeRealm = () => {
    inRealm = new Set();
    if (realm < 0) return;
    for (const st of sim.settlements) {
      if (st.ruined || st.clan !== realm) continue;
      for (const q of st.pops ?? []) inRealm.add(track === 'culture' ? q.culture : track === 'language' ? q.language : q.race);
    }
  };
  const setTrack = (t: Track, select?: string) => {
    track = t;
    computeRealm();
    rebuild();
    picked = select ? lines.find((l) => l.id === select) ?? null : null;
    panel();
    draw();
  };

  // ---- Drawing.
  const size = () => {
    const r = canvas.parentElement!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const H = Math.max(r.height, TOP + lanes * LANE + AXIS);
    canvas.style.height = `${H}px`;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(H * dpr);
    return { W: r.width, H, dpr };
  };
  const xOf = (day: number, W: number) => ((day - view[0]) / Math.max(1, view[1] - view[0])) * (W - 20) + 10;
  const dayOf = (x: number, W: number) => view[0] + ((x - 10) / (W - 20)) * (view[1] - view[0]);
  const yOf = (lane: number) => TOP + lane * LANE + LANE / 2;
  const kin = (l: Line): Set<string> => {
    const byId = new Map(lines.map((q) => [q.id, q]));
    const out = new Set<string>([l.id]);
    const up = (q: Line) => {
      for (const p of q.parents) {
        const pl = byId.get(p);
        if (pl && !out.has(pl.id)) {
          out.add(pl.id);
          up(pl);
        }
      }
    };
    const down = (q: Line) => {
      for (const c of lines) if (c.parents.includes(q.id) && !out.has(c.id)) {
        out.add(c.id);
        down(c);
      }
    };
    up(l);
    down(l);
    return out;
  };
  const draw = () => {
    const { W, H, dpr } = size();
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(dialog);
    const ink = css.getPropertyValue('--ink').trim() || '#222';
    const muted = css.getPropertyValue('--muted').trim() || '#888';
    g.clearRect(0, 0, W, H);
    const lit = hover ? kin(hover) : picked ? kin(picked) : null;
    const maxOf = (sub: boolean) => Math.max(1, ...lines.filter((l) => l.sub === sub).flatMap((l) => l.series.map(([, n]) => n)));
    const maxMain = maxOf(false);
    const maxSub = maxOf(true);
    const byId = new Map(lines.map((l) => [l.id, l]));
    const half = (l: Line, day: number, n: number) => {
      const thin = l.sub && (l.promoted === undefined || day < l.promoted);
      const base = thin ? 3 : 8;
      return base * (0.35 + 0.65 * Math.sqrt(n / (thin ? maxSub : maxMain)));
    };
    // Time axis.
    g.strokeStyle = muted;
    g.fillStyle = muted;
    g.font = '11px system-ui, sans-serif';
    g.lineWidth = 1;
    const years = (view[1] - view[0]) / 360;
    const stepY = [1, 5, 10, 25, 50, 100, 250, 500, 1000].find((s) => years / s <= 12) ?? 1000;
    const y0 = Math.ceil(yearOf(view[0]) / stepY) * stepY;
    for (let y = y0; (y - 1) * 360 <= view[1]; y += stepY) {
      const x = xOf((y - 1) * 360, W);
      g.globalAlpha = 0.25;
      g.beginPath();
      g.moveTo(x, TOP);
      g.lineTo(x, H - AXIS + 4);
      g.stroke();
      g.globalAlpha = 1;
      g.fillText(`Y${y}`, x + 2, H - 8);
    }
    for (const l of lines) {
      const a = l.start;
      const b = l.end ?? sim.day;
      const y = yOf(l.lane);
      const dim = lit && !lit.has(l.id);
      g.globalAlpha = dim ? 0.15 : 0.9;
      // Connectors from the parents (a split, a blend).
      g.strokeStyle = l.colour;
      g.lineWidth = 1.5;
      for (const p of l.parents) {
        const pl = byId.get(p);
        if (!pl) continue;
        const x = xOf(a, W);
        g.beginPath();
        g.moveTo(x - 14, yOf(pl.lane));
        g.bezierCurveTo(x - 4, yOf(pl.lane), x - 10, y, x, y);
        g.stroke();
      }
      // The band.
      const pts = l.series.filter(([d]) => d >= a - 360 * 5 && d <= b + 1);
      const series: [number, number][] = [[a, pts[0]?.[1] ?? l.series.find(([, n]) => n > 0)?.[1] ?? 1], ...pts.filter(([d]) => d > a && d < b), [b, pts[pts.length - 1]?.[1] ?? 1]];
      g.fillStyle = l.colour;
      g.beginPath();
      series.forEach(([dday, n], i) => {
        const x = xOf(dday, W);
        const w = half(l, dday, Math.max(n, 1));
        if (i === 0) g.moveTo(x, y - w);
        else g.lineTo(x, y - w);
      });
      for (let i = series.length - 1; i >= 0; i--) {
        const [dday, n] = series[i];
        g.lineTo(xOf(dday, W), y + half(l, dday, Math.max(n, 1)));
      }
      g.closePath();
      g.fill();
      // Its end: absorbed (a curve into the absorber) or extinct (a cap).
      if (l.end !== undefined) {
        const x = xOf(l.end, W);
        const ab = l.events.find((e) => e.kind === 'absorbed' && e.other && byId.has(e.other));
        g.strokeStyle = l.colour;
        g.lineWidth = 2;
        g.beginPath();
        if (ab) {
          const t = byId.get(ab.other!)!;
          g.moveTo(x, y);
          g.bezierCurveTo(x + 10, y, x + 4, yOf(t.lane), x + 14, yOf(t.lane));
        } else {
          g.moveTo(x, y - 7);
          g.lineTo(x, y + 7);
        }
        g.stroke();
      }
      // Major changes without a split: a diamond.
      for (const e of l.events) if (e.kind === 'religion' || e.kind === 'language') {
        const x = xOf(e.day, W);
        g.fillStyle = ink;
        g.beginPath();
        g.moveTo(x, y - 5);
        g.lineTo(x + 4, y);
        g.lineTo(x, y + 5);
        g.lineTo(x - 4, y);
        g.closePath();
        g.fill();
      }
      // Its name.
      g.fillStyle = ink;
      g.font = `${l.sub ? '' : 'bold '}11px system-ui, sans-serif`;
      const lx = Math.max(12, xOf(a, W) + 4);
      if (lx < W - 30) g.fillText(l.name, lx, y - (l.sub ? 5 : 10));
    }
    g.globalAlpha = 1;
    // The scrubbed date.
    if (scrubDay !== null) {
      const x = xOf(scrubDay, W);
      g.strokeStyle = ink;
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(x, TOP);
      g.lineTo(x, H - AXIS);
      g.stroke();
      g.setLineDash([]);
    }
    if (!lines.length) {
      g.fillStyle = muted;
      g.font = '13px system-ui, sans-serif';
      g.fillText(sim.history?.snaps.length ? 'Nothing to show with these filters.' : 'No history yet: it is kept every five years as the peoples run.', 16, 30);
    }
  };

  // ---- The panel for a picked line.
  const panel = () => {
    if (!picked) {
      side.replaceChildren(h('p', { class: 'muted small' }, 'Hover a line to light its ancestry and descendants; click it for its story. Wheel to zoom, drag to move along time.'));
      return;
    }
    const l = picked;
    const now = l.series[l.series.length - 1]?.[1] ?? 0;
    const peak = l.series.reduce((m, [d, n]) => (n > m[1] ? [d, n] : m), [0, 0] as [number, number]);
    const parts: (HTMLElement | null)[] = [
      h('h3', {}, l.name),
      h('div', { class: 'muted small' }, `${l.sub ? (track === 'language' ? 'A dialect' : track === 'race' ? 'A subrace' : 'A subculture') : track === 'language' ? 'A language' : track === 'race' ? 'A race' : 'A culture'}, from year ${yearOf(l.start)}${l.end !== undefined ? ` to year ${yearOf(l.end)}` : ''}.`),
      h('div', {}, `People: ${Math.round(now).toLocaleString()} now; most ${Math.round(peak[1]).toLocaleString()} (year ${yearOf(peak[0])}).`),
    ];
    if (track === 'culture') {
      const cu = sim.cultures?.find((c) => c.id === l.id);
      const snap = sim.history?.snaps[sim.history.snaps.length - 1];
      const provs = snap ? Object.values(snap.provs).filter((c) => c === l.id).length : 0;
      if (cu) {
        const b = bundleOf(d.lib(), cu);
        parts.push(
          h('div', {}, `Provinces where it is the main people: ${provs}.`),
          h('div', { class: 'small' }, `Values: ${b.values || '—'} · law: ${b.law} · ways: ${b.ways.map((id) => d.lib().traditions.find((t) => t.id === id)?.name ?? id).join(', ') || '—'}`),
          h('div', {}, 'Speaks: ', h('button', { type: 'button', class: 'link', onclick: () => setTrack('language', cu.language) }, sim.languages?.find((q) => q.id === cu.language)?.name ?? cu.language)),
          h('div', {}, 'Of: ', ...cu.races.map((r) => h('button', { type: 'button', class: 'link', onclick: () => setTrack('race', r) }, d.lib().species.flatMap((s) => s.races).find((q) => q.id === r)?.name ?? r))),
        );
      }
    }
    if (track === 'language') {
      const spoken = (sim.cultures ?? []).filter((c) => c.language === l.id);
      if (spoken.length) parts.push(h('div', {}, 'Tongue of: ', ...spoken.map((c) => h('button', { type: 'button', class: 'link', onclick: () => setTrack('culture', c.id) }, c.name))));
    }
    parts.push(h('div', { class: 'econ-head' }, 'What happened'), h('ul', { class: 'econ-list small' }, ...l.events.map((e) => h('li', {}, `Year ${yearOf(e.day)}: ${e.text}`))));
    side.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  };

  // ---- Interaction.
  const lineAt = (ev: MouseEvent): Line | null => {
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    const day = dayOf(x, r.width);
    const lane = Math.floor((y - TOP) / LANE);
    return lines.find((l) => l.lane === lane && day >= l.start - 360 && day <= (l.end ?? sim.day) + 360) ?? null;
  };
  let drag: { x: number; view: [number, number] } | null = null;
  canvas.addEventListener('mousedown', (ev) => {
    drag = { x: ev.clientX, view: [...view] as [number, number] };
  });
  window.addEventListener('mouseup', (ev) => {
    if (drag && Math.abs(ev.clientX - drag.x) < 3) {
      picked = lineAt(ev);
      panel();
      draw();
    }
    drag = null;
  });
  canvas.addEventListener('mousemove', (ev) => {
    if (drag) {
      const r = canvas.getBoundingClientRect();
      const per = (drag.view[1] - drag.view[0]) / (r.width - 20);
      const dx = (ev.clientX - drag.x) * per;
      view = [drag.view[0] - dx, drag.view[1] - dx];
      draw();
      return;
    }
    const l = lineAt(ev);
    if (l !== hover) {
      hover = l;
      canvas.title = l ? `${l.name}${l.events.length ? ` — ${l.events[0].text}` : ''}` : '';
      draw();
    }
  });
  canvas.addEventListener('mouseleave', () => {
    hover = null;
    draw();
  });
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    const at = dayOf(ev.clientX - r.left, r.width);
    const f = ev.deltaY > 0 ? 1.25 : 0.8;
    const span = Math.max(360 * 5, (view[1] - view[0]) * f);
    const t = (at - view[0]) / (view[1] - view[0]);
    view = [at - span * t, at + span * (1 - t)];
    draw();
  }, { passive: false });
  subsBox.addEventListener('change', () => {
    showSubs = subsBox.checked;
    rebuild();
  });
  famSel.addEventListener('change', () => {
    family = famSel.value;
    rebuild();
  });
  realmSel.addEventListener('change', () => {
    realm = Number(realmSel.value);
    computeRealm();
    rebuild();
  });
  const scrubTo = () => {
    const [a, b] = range();
    const day = a + ((b - a) * slider.valueAsNumber) / 1000;
    scrubDay = slider.valueAsNumber >= 1000 ? null : day;
    sliderLabel.textContent = scrubDay === null ? 'now' : `year ${yearOf(day)}`;
    d.scrub(onMap ? scrubDay : null);
    draw();
  };
  slider.addEventListener('input', scrubTo);
  mapBox.addEventListener('change', () => {
    onMap = mapBox.checked;
    scrubTo();
  });
  window.addEventListener('resize', () => dialog.open && draw());

  dialog.show();
  rebuild();
  fit();
  panel();
  scrubTo();
}
