import { RES_NAMES } from '../engine/data/economy';
import { ERA_NAMES, TECHS, TECH_BY_ID, TECH_CATEGORIES, techCost, type TechDef, type TechEffects } from '../engine/data/techs';
import { canResearch } from '../engine/systems/technology';
import type { Polity } from '../engine/types';
import type { World } from '../engine/world';

type Status = 'known' | 'researching' | 'available' | 'blocked' | 'locked' | 'absent';

const COL_W = 176;
const COL_GAP = 44;
const NODE_H = 58;
const ROW_GAP = 12;
const TOP = 34;

const EFFECT_LABELS: Record<keyof TechEffects, string> = {
  food: 'Food', fish: 'Fishing', timber: 'Timber', mining: 'Mining', craft: 'Crafting', housingMax: 'Max city size',
  tradeRange: 'Trade range', tradeEff: 'Trade efficiency', research: 'Research', military: 'Military', defense: 'Defence',
  sanitation: 'Sanitation', seaTravel: 'Sea travel', roads: 'Roads', stability: 'Stability', storage: 'Food storage',
  control: 'Governing reach', magic: 'Magic', metallurgy: 'Metallurgy',
};
const SEA = ['none', 'coastal waters', 'open sea', 'oceans'];
const METAL = ['stone', 'copper', 'bronze', 'iron', 'steel'];

function effectText(t: TechDef): string {
  return (Object.entries(t.effects) as [keyof TechEffects, number][])
    .map(([k, v]) => {
      if (k === 'housingMax') return `${EFFECT_LABELS[k]} ${v.toLocaleString('en-US')}`;
      if (k === 'seaTravel') return `Sea travel: ${SEA[v]}`;
      if (k === 'metallurgy') return `Tools & arms: ${METAL[v]}`;
      if (k === 'roads') return v >= 2 ? 'Highways' : 'Paved roads';
      return `${EFFECT_LABELS[k]} ${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
    })
    .join(' · ');
}

export function techStatus(world: World, p: Polity | null, t: TechDef): Status {
  if (t.arcane && world.cfg.magic <= 0) return 'absent';
  if (!p) return 'available';
  if (p.techs.has(t.id)) return 'known';
  if (p.researching === t.id) return 'researching';
  if (t.prereqs.some((x) => !p.techs.has(x))) return 'locked';
  return canResearch(world, p, t) ? 'available' : 'blocked';
}

function missing(world: World, p: Polity, t: TechDef): string {
  const out: string[] = [];
  if (t.requires) for (const r of t.requires) {
    const ok = canResearch(world, p, { ...t, requires: [r], requiresWater: false, prereqs: [] });
    if (!ok) out.push(RES_NAMES[r].toLowerCase());
  }
  if (t.requiresWater && !canResearch(world, p, { ...t, requires: [], prereqs: [] })) out.push('a coast or river');
  return out.join(', ');
}

/** Every tech placed in an era column; rows grouped by category so related paths line up. */
function layout(): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  for (let e = 0; e < ERA_NAMES.length; e++) {
    const col = TECHS.filter((t) => t.era === e).sort((a, b) => TECH_CATEGORIES.indexOf(a.category) - TECH_CATEGORIES.indexOf(b.category));
    col.forEach((t, i) => pos.set(t.id, { x: e * (COL_W + COL_GAP), y: TOP + i * (NODE_H + ROW_GAP) }));
  }
  return pos;
}

function ancestors(id: string, acc = new Set<string>()): Set<string> {
  for (const p of TECH_BY_ID.get(id)?.prereqs ?? []) if (!acc.has(p)) {
    acc.add(p);
    ancestors(p, acc);
  }
  return acc;
}

function descendants(id: string): Set<string> {
  const out = new Set<string>();
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const t of TECHS) if (!out.has(t.id) && t.prereqs.some((x) => frontier.includes(x))) {
      out.add(t.id);
      next.push(t.id);
    }
    frontier = next;
  }
  return out;
}

/**
 * Draw the whole tech tree: eras as columns, prerequisites as curves, each tech coloured
 * by its status for the chosen nation. Selecting a tech lights up the path to it and
 * everything it leads to, and shows who in the world already knows it.
 */
export function mountTechTree(host: HTMLElement, world: World, polityId: number, selected: string | null, onSelect: (id: string) => void, esc: (s: string) => string): void {
  const p = polityId >= 0 ? world.polities[polityId] : null;
  const pos = layout();
  const maxRows = Math.max(...ERA_NAMES.map((_, e) => TECHS.filter((t) => t.era === e).length));
  const W = ERA_NAMES.length * (COL_W + COL_GAP) - COL_GAP;
  const H = TOP + maxRows * (NODE_H + ROW_GAP);
  const path = selected ? new Set([...ancestors(selected), selected]) : null;
  const leads = selected ? descendants(selected) : null;

  let svg = `<svg class="tt-lines" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">`;
  for (const t of TECHS) {
    const b = pos.get(t.id)!;
    for (const pre of t.prereqs) {
      const a = pos.get(pre)!;
      const x1 = a.x + COL_W;
      const y1 = a.y + NODE_H / 2;
      const x2 = b.x;
      const y2 = b.y + NODE_H / 2;
      const mid = (x1 + x2) / 2;
      const on = path?.has(t.id) && path.has(pre);
      const fwd = leads && (leads.has(t.id) && (leads.has(pre) || pre === selected));
      svg += `<path d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}" class="${on ? 'on' : fwd ? 'fwd' : ''}"/>`;
    }
  }
  svg += '</svg>';

  const heads = ERA_NAMES.map((n, e) => `<div class="tt-era" style="left:${e * (COL_W + COL_GAP)}px;width:${COL_W}px">${n}</div>`).join('');
  const nodes = TECHS.map((t) => {
    const { x, y } = pos.get(t.id)!;
    const st = techStatus(world, p, t);
    const dim = path && !path.has(t.id) && !leads?.has(t.id);
    const knownBy = [...world.alivePolities()].filter((q) => q.techs.has(t.id)).length;
    return `<button type="button" class="tt-node ${st}${t.id === selected ? ' sel' : ''}${dim ? ' dim' : ''}" data-tech="${t.id}" style="left:${x}px;top:${y}px;width:${COL_W}px;height:${NODE_H}px">
      <span class="cat c-${t.category}"></span>
      <b>${esc(t.name)}</b>
      <small>${st === 'known' ? 'Known' : st === 'researching' ? `Researching ${Math.round(Math.min(1, (p!.researchProgress) / techCost(t)) * 100)}%` : st === 'blocked' ? `Needs ${esc(missing(world, p!, t))}` : st === 'absent' ? 'No magic in this world' : st === 'locked' ? 'Locked' : 'Can research'}${knownBy ? ` · ${knownBy} realm${knownBy > 1 ? 's' : ''}` : ''}</small>
    </button>`;
  }).join('');

  host.innerHTML = `<div class="tt-scroll"><div class="tt-canvas" style="width:${W}px;height:${H}px">${heads}${svg}${nodes}</div></div>`;
  host.querySelectorAll<HTMLButtonElement>('[data-tech]').forEach((b) => b.addEventListener('click', () => onSelect(b.dataset.tech!)));
}

/** Details for one tech: what it does, what it needs, and which peoples know it. */
export function techDetail(world: World, polityId: number, id: string, esc: (s: string) => string, pLink: (id: number) => string): string {
  const t = TECH_BY_ID.get(id)!;
  const p = polityId >= 0 ? world.polities[polityId] : null;
  const st = techStatus(world, p, t);
  const knowers = [...world.alivePolities()].filter((q) => q.techs.has(id)).sort((a, b) => b.pop - a.pop);
  const first = world.firstTech.get(id);
  const unlocks = TECHS.filter((x) => x.prereqs.includes(id));
  return `
    <div class="tt-detail-head"><span class="cat c-${t.category}"></span><h3>${esc(t.name)}</h3><span class="chip">${ERA_NAMES[t.era]}</span><span class="chip">${t.category}</span>${p ? `<span class="chip ${st === 'known' ? 'ok' : st === 'blocked' ? 'crit' : ''}">${st}</span>` : ''}</div>
    <p>${esc(t.description)}</p>
    <p class="small"><span class="k">Effects</span> ${effectText(t) || '—'}</p>
    <p class="small"><span class="k">Needs</span> ${t.prereqs.length ? t.prereqs.map((x) => TECH_BY_ID.get(x)!.name).join(', ') : 'nothing'}${t.requires?.length ? `; access to ${t.requires.map((r) => RES_NAMES[r].toLowerCase()).join(' and ')} (own land or trade)` : ''}${t.requiresWater ? '; a coast or river' : ''}. Cost ${techCost(t).toLocaleString('en-US')} research, less if neighbours know it.</p>
    <p class="small"><span class="k">Leads to</span> ${unlocks.length ? unlocks.map((x) => x.name).join(', ') : 'nothing further'}</p>
    <p class="small"><span class="k">Known by</span> ${knowers.length ? `${knowers.slice(0, 8).map((q) => pLink(q.id)).join(', ')}${knowers.length > 8 ? ` and ${knowers.length - 8} more` : ''}` : 'no one yet'}${first !== undefined ? `. First discovered by ${pLink(first)}.` : ''}</p>`;
}
