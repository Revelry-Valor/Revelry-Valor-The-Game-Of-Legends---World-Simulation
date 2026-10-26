import { h } from './dom';

/**
 * The right-hand panels that read the world for you:
 * - "Under the cursor": what the pointer is over, as named fields (Latitude, Ground, Climate zone,
 *   Settlement…), with a menu to choose which fields appear.
 * - "Resources": for the selected settlement or realm, its main resources by type, each a symbol
 *   (its name on hover), with every resource it holds and finds in its lands a click away.
 */

/** One named piece of what is under the cursor. */
export interface InfoItem {
  label: string;
  value: string;
}

/** The fields, in groups, for choosing what the panel shows. */
export const INFO_GROUPS: { name: string; labels: string[] }[] = [
  { name: 'Position', labels: ['Latitude', 'From the west edge'] },
  { name: 'Place', labels: ['Place'] },
  { name: 'Land and water', labels: ['Ground', 'Terrain', 'Ground cover', 'Water', 'Hazard'] },
  { name: 'Climate', labels: ['Climate zone', 'Summer', 'Winter', 'Sea', 'Sea ice', 'Fishing'] },
  { name: 'Peoples', labels: ['Tribe', 'Settlement', 'Realm'] },
  { name: 'War', labels: ['Army', 'Battle', 'Spy'] },
  { name: 'Faith', labels: ['Holy site'] },
  { name: 'Travel and trade', labels: ['Way', 'Crossing', 'Caravan'] },
  { name: 'Resources and beasts', labels: ['Resource', 'Beast'] },
];

const HIDDEN_KEY = 'rv.info.hidden';
function loadHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function saveHidden(s: Set<string>): void {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s]));
  } catch {
    // Not kept (private window or blocked storage): the choice lasts this visit.
  }
}

/** The "Under the cursor" panel. */
export function createInfoPanel(): { el: HTMLElement; show(items: InfoItem[] | null): void } {
  const hidden = loadHidden();
  const body = h('div', { class: 'info-body' });
  let last: InfoItem[] | null = null;
  const render = () => {
    const shown = (last ?? []).filter((i) => !hidden.has(i.label));
    body.replaceChildren(
      ...(last === null
        ? [h('p', { class: 'muted small' }, 'Move over the map to see what is there.')]
        : shown.length
          ? [h('dl', { class: 'info-list' }, ...shown.flatMap((i) => [h('dt', {}, i.label), h('dd', {}, i.value)]))]
          : [h('p', { class: 'muted small' }, 'Nothing to show here with the fields chosen.')]),
    );
  };
  const choose = h('details', { class: 'drop info-choose' },
    h('summary', {}, 'Fields'),
    h('div', { class: 'drop-body' },
      h('p', { class: 'muted small' }, 'Choose what this panel shows.'),
      ...INFO_GROUPS.map((g) => h('fieldset', { class: 'info-group' },
        h('legend', {}, g.name),
        ...g.labels.map((l) => h('label', { class: 'field-row' }, h('input', { type: 'checkbox', checked: !hidden.has(l), onchange: (e: Event) => {
          if ((e.target as HTMLInputElement).checked) hidden.delete(l);
          else hidden.add(l);
          saveHidden(hidden);
          render();
        } }), l)),
      )),
    ),
  );
  const el = h('section', { class: 'info-panel', 'aria-label': 'Under the cursor' }, h('div', { class: 'info-head' }, h('h2', {}, 'Under the cursor'), choose), body);
  render();
  return {
    el,
    show(items) {
      last = items;
      render();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Resources

/** A symbol for each resource (by id), and for each type when a resource has none of its own. */
const RES_ICON: Record<string, string> = {
  grain: '🌾', rice: '🍚', roots: '🥔', fruit: '🍎', olives: '🫒', grapes: '🍇', nuts: '🌰', fish: '🐟', shellfish: '🦪', game: '🍖', livestock: '🐄', honey: '🍯', fungus: '🍄', sugar: '🍬',
  salt: '🧂', spices: '🌶️', tea: '🍵', cotton: '☁️', flax: '🌿', herbs: '🌱', dyes: '🎨', reeds: '🎋',
  hardwood: '🌳', softwood: '🌲', 'exotic-wood': '🌴',
  stone: '🧱', marble: '🏛️', clay: '🏺', sand: '⏳', obsidian: '🔪', pumice: '🪨',
  copper: '🟠', tin: '⚪', iron: '⚙️', lead: '⚫', silver: '🥈', gold: '🥇',
  coal: '🔥', sulfur: '🟡', saltpeter: '🧪',
  gems: '💎', amber: '🟧', pearls: '🦪',
  furs: '🦊', leather: '🥾', wool: '🐑', ivory: '🦣', feathers: '🪶', horn: '📯',
  silk: '🧵', wine: '🍷', incense: '🕯️',
  'mana-crystal': '🔮', 'rift-iron': '🌀',
};
const TYPE_ICON: Record<string, string> = { Food: '🍞', Plant: '🌿', Wood: '🪵', Stone: '🪨', Mineral: '⛏️', Metal: '🔩', Gem: '💎', 'Animal product': '🐾', Luxury: '✨', 'Rift and mana': '🔮' };
export const resIcon = (id: string, category: string) => RES_ICON[id] ?? TYPE_ICON[category] ?? '📦';

/** What the resource panel is showing: a settlement or a realm, what it holds, and what is found in its lands. */
export interface ResourceView {
  kind: 'Settlement' | 'Realm';
  name: string;
  /** Held in store, by resource id (units). */
  stores: Record<string, number>;
  /** Found in its lands, by resource id (0–1: how good or rich). */
  land: Record<string, number>;
  /** Each resource's name and type. */
  info: (id: string) => { name: string; category: string } | undefined;
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : n >= 10 ? String(Math.round(n)) : n.toFixed(1));

/** The resource panel (top right). */
export function createResourcePanel(): { el: HTMLElement; show(v: ResourceView | null): void } {
  const body = h('div', { class: 'res-body' });
  const dialog = h('dialog', { class: 'dialog res-dialog' });
  let view: ResourceView | null = null;
  const byType = (ids: string[]) => {
    const groups = new Map<string, string[]>();
    for (const id of ids) {
      const cat = view!.info(id)?.category ?? 'Other';
      groups.set(cat, [...(groups.get(cat) ?? []), id]);
    }
    return [...groups].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const chip = (id: string, amount?: string) => {
    const info = view!.info(id);
    const name = info?.name ?? id;
    return h('span', { class: 'res-chip', title: amount ? `${name}: ${amount}` : name, 'aria-label': name }, h('span', { class: 'res-icon' }, resIcon(id, info?.category ?? '')), amount ? h('span', { class: 'res-amt' }, amount) : null);
  };
  const openAll = () => {
    if (!view) return;
    const v = view;
    const held = Object.keys(v.stores).filter((id) => v.stores[id] >= 0.5).sort((a, b) => v.stores[b] - v.stores[a]);
    const found = Object.keys(v.land).filter((id) => v.land[id] > 0.02).sort((a, b) => v.land[b] - v.land[a]);
    const table = (ids: string[], val: (id: string) => string) =>
      byType(ids).map(([cat, list]) => h('div', { class: 'res-type' },
        h('div', { class: 'econ-head' }, `${TYPE_ICON[cat] ?? '📦'} ${cat}`),
        h('ul', { class: 'econ-list' }, ...list.map((id) => h('li', {}, h('span', {}, h('span', { class: 'res-icon' }, resIcon(id, cat)), ' ', v.info(id)?.name ?? id), h('span', { class: 'num' }, val(id))))),
      ));
    dialog.replaceChildren(
      h('h2', {}, `${v.name}: every resource`),
      h('p', { class: 'muted small' }, `${v.kind === 'Realm' ? 'All its towns together' : 'This settlement'}: what it holds in store (units), and what is found in ${v.kind === 'Realm' ? 'the land it claims' : 'the land it works'}.`),
      h('div', { class: 'res-columns' },
        h('div', {}, h('h3', {}, 'Held in store'), ...(held.length ? table(held, (id) => fmt(v.stores[id])) : [h('p', { class: 'muted' }, 'Nothing in store.')])),
        h('div', {}, h('h3', {}, 'Found in its lands'), ...(found.length ? table(found, (id) => `${Math.round(Math.min(1, v.land[id]) * 100)}%`) : [h('p', { class: 'muted' }, 'Nothing found.')])),
      ),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'primary', onclick: () => dialog.close() }, 'Close')),
    );
    dialog.showModal();
  };
  const render = () => {
    if (!view) {
      body.replaceChildren(h('p', { class: 'muted small' }, 'Select a settlement or a realm (in the Peoples tab, or click it on the map) to see its resources.'));
      return;
    }
    const v = view;
    // Its main resources: the biggest stores of each type (up to four a type).
    const held = Object.keys(v.stores).filter((id) => v.stores[id] >= 1);
    const groups = byType(held);
    body.replaceChildren(
      h('div', { class: 'res-title' }, h('strong', {}, v.name), h('span', { class: 'muted' }, ` · ${v.kind.toLowerCase()}`)),
      ...(groups.length
        ? groups.map(([cat, ids]) => h('div', { class: 'res-row' },
            h('span', { class: 'res-type-name', title: cat }, cat),
            h('span', { class: 'res-chips' }, ...ids.sort((a, b) => v.stores[b] - v.stores[a]).slice(0, 4).map((id) => chip(id, fmt(v.stores[id])))),
          ))
        : [h('p', { class: 'muted small' }, 'Nothing in store yet.')]),
      h('button', { type: 'button', class: 'ghost small', onclick: openAll }, 'All resources…'),
    );
  };
  const el = h('section', { class: 'res-panel', 'aria-label': 'Resources' }, h('h2', {}, 'Resources'), body, dialog);
  render();
  return {
    el,
    show(v) {
      view = v;
      render();
    },
  };
}
