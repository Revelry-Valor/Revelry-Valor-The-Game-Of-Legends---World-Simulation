import { ZONE_INFO } from '../core/climate';
import {
  ACTIVE,
  ATTITUDES,
  BEAST_USES,
  BUILDING,
  cloneLibrary,
  DIETS,
  EFFECT_TARGETS,
  HERDING,
  LAYERS_PREF,
  LIFESTYLES,
  LIMBS,
  makeId,
  MOVES,
  newBeast,
  newRace,
  newResource,
  newSpecies,
  newTrait,
  RARITIES,
  raceMissing,
  RESOURCE_CATEGORIES,
  RESOURCE_SOURCES,
  SENSES,
  SIZES,
  SOCIAL,
  STAT_HINTS,
  STAT_KEYS,
  STAT_NAMES,
  statTotal,
  TERRAINS,
  BEHAVIOUR_CATEGORIES,
  CULTURE_LIFESTYLES,
  ETHOS,
  MARTIAL,
  newBehaviour,
  newCulture,
  newTech,
  newTradition,
  PLACES,
  TECH_FIELDS,
  techTiers,
  TRADITION_CATEGORIES,
  type Behaviour,
  type Culture,
  type Faith,
  type God,
  type Government,
  type Tenet,
  BELIEF_NATURE,
  FAITH_CLERGY,
  FAITH_LEADERS,
  FAITH_MANA,
  FAITH_MARRIAGE,
  FAITH_ORGANIZATION,
  FAITH_TOLERANCE,
  GOD_DOMAINS,
  GOD_PERSONALITY,
  GOD_POWERS,
  GOV_ARMY,
  GOV_HEAD,
  GOV_LAND,
  GOV_LAW,
  GOV_LEGITIMACY,
  GOV_RULING,
  GOV_SUCCESSION,
  HOLY_SITE_KINDS,
  newFaith,
  newGod,
  newGovernment,
  newTenet,
  type Tech,
  type Tradition,
  type Beast,
  type Library,
  type Profile,
  type Race,
  type Resource,
  type Species,
  type Stats,
  type Trait,
} from '../core/library';
import { defaultLibrary, libraryFile, loadSharedLibrary, parseLibraryFile, saveSharedLibrary } from '../core/libstore';
import { BRUSHES, COVER_BRUSHES } from '../core/paint';
import type { World } from '../core/world';
import { h, toast } from './dom';
import type { App } from './main';

/**
 * The Library: the creators for the data the simulation reads (REDESIGN.md 8.2–8.3): peoples
 * (species and their races), beasts, traits and resources. It edits either the shared library
 * on this device or one world's own copy; everything saves as you type.
 */
export function showLibrary(app: App, world: World | null): () => void {
  let lib: Library = world ? cloneLibrary(world.library ?? loadSharedLibrary(app.store)) : loadSharedLibrary(app.store);
  let w = world;
  let saveTimer = 0;
  const status = h('span', { class: 'muted small', 'aria-live': 'polite' }, 'Saved');
  const saveNow = () => {
    clearTimeout(saveTimer);
    try {
      if (w) {
        w = { ...w, library: lib, updatedAt: Date.now() };
        if (!app.save(w)) return;
      } else saveSharedLibrary(app.store, lib);
      status.textContent = 'Saved';
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const changed = () => {
    status.textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveNow, 500);
    renderListSoon();
  };

  type Tab = 'species' | 'beasts' | 'traits' | 'resources' | 'techs' | 'behaviours' | 'traditions' | 'cultures' | 'governments' | 'faiths' | 'tenets' | 'gods';
  let tab: Tab = 'species';
  let selected: string | null = null;
  let raceSel = 0;
  let search = '';

  const listEl = h('div', { class: 'lib-list' });
  const editor = h('div', { class: 'lib-editor' });
  const tabsEl = h('div', { class: 'tabs lib-tabs', role: 'tablist' });

  const coverName = (c: string) => BRUSHES.find((b) => b.id === c)?.name ?? c;
  const ZONE_NAMES = ZONE_INFO.map((z) => z.name);
  const MOUNTAIN_ZONES = ['Lowland', 'Foothills', 'Highlands', 'High mountains', 'Peaks'];
  const TOL = ['1 poor', '2', '3 fair', '4', '5 excellent'];

  // ---------------------------------------------------------------------------------------------
  // Field builders: each edits a value in place and reports the change.

  let fid = 0;
  const nextId = () => `lf${++fid}`;
  const field = (label: string, control: HTMLElement, hint?: string, id?: string) =>
    h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('small', {}, hint) : null);
  const text = (label: string, get: () => string, set: (v: string) => void, opts: { long?: boolean; hint?: string; list?: string[]; onName?: boolean } = {}) => {
    const id = nextId();
    const listId = opts.list ? `${id}l` : undefined;
    const input = opts.long ? (h('textarea', { id, rows: 3 }) as HTMLTextAreaElement) : (h('input', { id, type: 'text', list: listId }) as HTMLInputElement);
    input.value = get();
    input.addEventListener('input', () => {
      set(input.value);
      changed();
    });
    return field(label, h('div', {}, input, opts.list ? h('datalist', { id: listId }, ...opts.list.map((v) => h('option', { value: v }))) : null), opts.hint, id);
  };
  const num = (label: string, get: () => number | null, set: (v: number | null) => void, opts: { hint?: string; unit?: string; min?: number; max?: number; step?: number } = {}) => {
    const id = nextId();
    const input = h('input', { id, type: 'number', inputmode: 'decimal', min: opts.min, max: opts.max, step: opts.step ?? 1, placeholder: '—' }) as HTMLInputElement;
    const v = get();
    input.value = v === null ? '' : String(v);
    input.addEventListener('input', () => {
      set(input.value.trim() === '' || !Number.isFinite(input.valueAsNumber) ? null : input.valueAsNumber);
      changed();
    });
    return field(label, h('div', { class: 'field-row' }, input, opts.unit ? h('span', { class: 'unit' }, opts.unit) : null), opts.hint, id);
  };
  const select = (label: string, options: readonly string[], get: () => string, set: (v: string) => void, opts: { hint?: string; blank?: string; names?: string[] } = {}) => {
    const id = nextId();
    const sel = h('select', { id }, h('option', { value: '' }, opts.blank ?? '—'), ...options.map((o, i) => h('option', { value: o }, opts.names?.[i] ?? o))) as HTMLSelectElement;
    sel.value = get();
    sel.addEventListener('change', () => {
      set(sel.value);
      changed();
    });
    return field(label, sel, opts.hint, id);
  };
  const scale = (label: string, get: () => number | null, set: (v: number | null) => void, names: string[], hint?: string) =>
    select(label, names.map((_, i) => String(i + 1)), () => (get() === null ? '' : String(get())), (v) => set(v ? Number(v) : null), { hint, names });
  /** A set of chips to tick. Values are strings or numbers (indices). */
  const multi = <T extends string | number>(label: string, options: readonly T[], names: readonly string[], get: () => T[], set: (v: T[]) => void, hint?: string) => {
    const box = h('div', { class: 'chips', role: 'group', 'aria-label': label });
    const render = () => {
      const now = get();
      box.replaceChildren(
        ...options.map((o, i) => {
          const on = now.includes(o);
          return h('button', { type: 'button', class: 'chip', 'aria-pressed': on ? 'true' : 'false', onclick: () => {
            const cur = get();
            set(cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]);
            changed();
            render();
          } }, names[i]);
        }),
      );
    };
    render();
    return h('div', { class: 'field' }, h('span', { class: 'label' }, label), box, hint ? h('small', {}, hint) : null);
  };
  const check = (label: string, get: () => boolean, set: (v: boolean) => void, hint?: string) => {
    const box = h('input', { type: 'checkbox', checked: get(), onchange: (e: Event) => { set((e.target as HTMLInputElement).checked); changed(); } });
    return h('div', { class: 'field' }, h('label', { class: 'field-row small' }, box, label), hint ? h('small', {}, hint) : null);
  };
  const section = (title: string, ...children: (HTMLElement | null)[]) => h('details', { class: 'lib-section', open: true }, h('summary', {}, title), h('div', { class: 'lib-grid' }, ...children));
  /** Rows of (species, value) pairs: attitudes to and interbreeding with other species. */
  const pairs = (label: string, rows: () => { species: string; v: string }[], set: (rows: { species: string; v: string }[]) => void, valueField: 'attitude' | 'text', hint: string) => {
    const box = h('div', { class: 'pairs' });
    const others = [...lib.species.map((s) => s.name), ...lib.beasts.map((b) => b.name)];
    const render = () => {
      const list = rows();
      box.replaceChildren(
        ...list.map((r, i) => {
          const sp = h('select', {}, h('option', { value: '' }, 'Species…'), ...others.map((o) => h('option', { value: o }, o))) as HTMLSelectElement;
          sp.value = r.species;
          sp.addEventListener('change', () => {
            list[i] = { ...list[i], species: sp.value };
            set(list);
            changed();
          });
          const val = valueField === 'attitude' ? (h('select', {}, ...ATTITUDES.map((a) => h('option', { value: a }, a))) as HTMLSelectElement) : (h('input', { type: 'text', placeholder: 'Result (e.g. half-blood race)' }) as HTMLInputElement);
          val.value = r.v || (valueField === 'attitude' ? 'Wary' : '');
          val.addEventListener(valueField === 'attitude' ? 'change' : 'input', () => {
            list[i] = { ...list[i], v: val.value };
            set(list);
            changed();
          });
          return h('div', { class: 'pair-row' }, sp, val, h('button', { type: 'button', class: 'ghost small', 'aria-label': 'Remove', onclick: () => { list.splice(i, 1); set(list); changed(); render(); } }, '×'));
        }),
        h('button', { type: 'button', class: 'ghost small', onclick: () => { set([...rows(), { species: '', v: valueField === 'attitude' ? 'Wary' : '' }]); changed(); render(); } }, '+ Add'),
      );
    };
    render();
    return h('div', { class: 'field wide' }, h('span', { class: 'label' }, label), box, h('small', {}, hint));
  };
  /** Picked items from a long list: chips to remove, and a list to add from. */
  type Opt = { id: string; name: string; group?: string };
  const refs = (label: string, options: () => Opt[], get: () => string[], set: (v: string[]) => void, hint?: string) => {
    const chips = h('div', { class: 'chips' });
    const add = h('select', { 'aria-label': `Add to ${label}` }) as HTMLSelectElement;
    const render = () => {
      const opts = options();
      const now = get();
      const nameOf = (id: string) => opts.find((o) => o.id === id)?.name ?? id;
      chips.replaceChildren(
        ...now.map((id) => h('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', title: 'Remove', onclick: () => { set(get().filter((x) => x !== id)); changed(); render(); } }, nameOf(id), ' ×')),
        ...(now.length ? [] : [h('span', { class: 'muted small' }, 'None')]),
      );
      const free = opts.filter((o) => !now.includes(o.id));
      const groups = new Map<string, Opt[]>();
      for (const o of free) groups.set(o.group ?? '', [...(groups.get(o.group ?? '') ?? []), o]);
      add.replaceChildren(
        h('option', { value: '' }, '+ Add…'),
        ...[...groups].map(([g, list]) => (g ? h('optgroup', { label: g }, ...list.map((o) => h('option', { value: o.id }, o.name))) : list.map((o) => h('option', { value: o.id }, o.name)))).flat(),
      );
    };
    add.addEventListener('change', () => {
      if (!add.value) return;
      set([...get(), add.value]);
      changed();
      render();
    });
    render();
    return h('div', { class: 'field wide' }, h('span', { class: 'label' }, label), h('div', { class: 'refs' }, chips, add), hint ? h('small', {}, hint) : null);
  };
  const techOpts = (except?: string): Opt[] => lib.techs.filter((t) => t.id !== except).map((t) => ({ id: t.id, name: t.name, group: t.field || 'Other' }));
  const behaviourOpts = (except?: string): Opt[] => lib.behaviours.filter((b) => b.id !== except).map((b) => ({ id: b.id, name: b.name, group: b.category || 'Other' }));
  const resourceOpts = (): Opt[] => lib.resources.map((r) => ({ id: r.id, name: r.name, group: r.category || 'Other' }));
  const nameIn = <T extends { id: string; name: string }>(list: T[], ids: string[]) => ids.map((id) => list.find((x) => x.id === id)?.name ?? id);

  const statsGrid = (stats: Stats, onChange: () => void) => {
    const total = h('strong', {});
    const showTotal = () => (total.textContent = statTotal(stats)?.toString() ?? '— (some stats missing)');
    const grid = h(
      'div',
      { class: 'stats-grid' },
      ...STAT_KEYS.map((k) => {
        const id = nextId();
        const input = h('input', { id, type: 'number', inputmode: 'decimal', placeholder: '—', title: STAT_HINTS[k] ?? STAT_NAMES[k] }) as HTMLInputElement;
        input.value = stats[k] === null ? '' : String(stats[k]);
        input.addEventListener('input', () => {
          stats[k] = input.value.trim() === '' || !Number.isFinite(input.valueAsNumber) ? null : input.valueAsNumber;
          showTotal();
          onChange();
          changed();
        });
        return h('div', { class: 'stat' }, h('label', { for: id, title: STAT_HINTS[k] ?? '' }, STAT_NAMES[k]), input);
      }),
    );
    showTotal();
    return h('div', { class: 'field wide' }, h('span', { class: 'label' }, 'Stats'), grid, h('p', { class: 'small' }, 'Total: ', total, h('span', { class: 'muted' }, ' · Human is the yardstick (Speed 30 is an ordinary day’s march). Hover a stat for what it does.')));
  };

  // Body, life, environment and relations: shared by species and beasts.
  const profileSections = (p: Profile, sentient: boolean): HTMLElement[] => [
    section(
      'Body',
      text('Build', () => p.build, (v) => (p.build = v), { hint: 'Shape and look, in a few words (e.g. stocky, long-limbed, serpentine).' }),
      text('Natural weapons', () => p.naturalWeapons, (v) => (p.naturalWeapons = v), { hint: 'Claws, horns, tusks, venom…' }),
      multi('Limbs', LIMBS, LIMBS, () => p.limbs, (v) => (p.limbs = v)),
      multi('Senses', SENSES, SENSES, () => p.senses, (v) => (p.senses = v)),
      multi('Movement', MOVES, MOVES, () => p.movement, (v) => (p.movement = v), 'How it gets about; speeds are in the stats.'),
    ),
    section(
      'Life',
      num('Age of adulthood', () => p.adulthood, (v) => (p.adulthood = v), { unit: 'years', min: 0 }),
      num('Offspring per birth', () => p.offspring, (v) => (p.offspring = v), { min: 0, step: 0.1 }),
      num('A birth every', () => p.birthEveryYears, (v) => (p.birthEveryYears = v), { unit: 'years', min: 0, step: 0.1 }),
      select('Diet', DIETS, () => p.diet, (v) => (p.diet = v)),
      text('Special diet', () => p.dietSpecial, (v) => (p.dietSpecial = v), { hint: 'For a special diet: mana, minerals, sunlight…' }),
      select('Active', ACTIVE, () => p.active, (v) => (p.active = v)),
    ),
    section(
      'Environment',
      multi('Preferred climates', ZONE_INFO.map((_, i) => i), ZONE_NAMES, () => p.climates, (v) => (p.climates = v)),
      multi('Preferred ground cover', COVER_BRUSHES, COVER_BRUSHES.map(coverName), () => p.covers, (v) => (p.covers = v)),
      multi('Mountain zones', [0, 1, 2, 3, 4], MOUNTAIN_ZONES, () => p.mountainZones, (v) => (p.mountainZones = v), 'Where it can live, from lowland to peaks.'),
      scale('Heat tolerance', () => p.heat, (v) => (p.heat = v), TOL),
      scale('Cold tolerance', () => p.cold, (v) => (p.cold = v), TOL),
      scale('Wet tolerance', () => p.wet, (v) => (p.wet = v), TOL),
      scale('Dry tolerance', () => p.dry, (v) => (p.dry = v), TOL),
      scale('Altitude tolerance', () => p.altitude, (v) => (p.altitude = v), TOL),
      multi('Layer', LAYERS_PREF, LAYERS_PREF, () => p.layers, (v) => (p.layers = v)),
      text('Special needs or benefits', () => p.needs, (v) => (p.needs = v), { hint: 'E.g. dense mana, near water, sunlight.' }),
    ),
    section(
      'Relations',
      select('Toward other species', ATTITUDES, () => p.attitude, (v) => (p.attitude = v), { hint: 'Its general attitude to others.' }),
      pairs('Exceptions', () => p.attitudes.map((a) => ({ species: a.species, v: a.attitude })), (rows) => (p.attitudes = rows.map((r) => ({ species: r.species, attitude: r.v }))), 'attitude', 'Particular species it feels differently about.'),
      sentient ? pairs('Can have children with', () => p.interbreeds.map((a) => ({ species: a.species, v: a.result })), (rows) => (p.interbreeds = rows.map((r) => ({ species: r.species, result: r.v }))), 'text', 'And what the children are.') : null,
    ),
  ];
  const traitPicker = (label: string, forWho: 'sentient' | 'beast', get: () => string[], set: (v: string[]) => void, hint?: string) => {
    const ts = lib.traits.filter((t) => t.for.includes(forWho));
    return multi(label, ts.map((t) => t.id), ts.map((t) => t.name), get, set, hint);
  };

  // ---------------------------------------------------------------------------------------------
  // Editors

  const raceEditor = (sp: Species, r: Race) =>
    h(
      'div',
      { class: 'lib-grid' },
      text('Race name', () => r.name, (v) => (r.name = v)),
      select('Size', SIZES, () => r.size ?? '', (v) => (r.size = (v || null) as Race['size'])),
      num('Fighting age', () => r.fightingAge, (v) => (r.fightingAge = v), { unit: 'years', min: 0 }),
      num('Lifespan', () => r.lifespan, (v) => (r.lifespan = v), { unit: 'years', min: 0 }),
      statsGrid(r.stats, () => renderMissing()),
      text('Affinity', () => r.affinity, (v) => (r.affinity = v)),
      text('Second affinity', () => r.affinity2, (v) => (r.affinity2 = v)),
      text('Specialty skills', () => r.specialty, (v) => (r.specialty = v), { hint: 'Unique racial abilities.' }),
      select('Lifestyle', LIFESTYLES, () => r.lifestyle, (v) => (r.lifestyle = v), { blank: `As the species${sp.lifestyle ? ` (${sp.lifestyle})` : ''}` }),
      traitPicker('Extra traits', 'sentient', () => r.addTraits, (v) => (r.addTraits = v), 'On top of the species’ traits.'),
      multi('Lacks these species traits', sp.traits, sp.traits.map((id) => lib.traits.find((t) => t.id === id)?.name ?? id), () => r.removeTraits, (v) => (r.removeTraits = v)),
      multi('Own preferred climates', ZONE_INFO.map((_, i) => i), ZONE_NAMES, () => r.climates, (v) => (r.climates = v), 'Leave empty to share the species’.'),
      text('Notes', () => r.notes, (v) => (r.notes = v), { long: true }),
    );
  const missingEl = h('p', { class: 'needs' });
  let missingFor: Race | null = null;
  const renderMissing = () => {
    const m = missingFor ? raceMissing(missingFor) : [];
    missingEl.hidden = !m.length;
    missingEl.textContent = m.length ? `Needs: ${m.join('; ')}. The simulation can’t use this race until these are filled in.` : '';
  };

  const speciesEditor = (sp: Species) => {
    raceSel = Math.min(raceSel, sp.races.length - 1);
    const r = sp.races[raceSel];
    missingFor = r;
    const raceTabs = h(
      'div',
      { class: 'seg race-tabs' },
      ...sp.races.map((x, i) =>
        h('button', { type: 'button', role: 'radio', 'aria-checked': i === raceSel ? 'true' : 'false', onclick: () => { raceSel = i; renderEditor(); } }, x.name || 'Unnamed', raceMissing(x).length ? h('span', { class: 'badge', title: 'Needs stats' }, '!') : null),
      ),
      h('button', { type: 'button', class: 'ghost small', onclick: () => {
        const taken = new Set(sp.races.map((x) => x.id));
        let n = sp.races.length + 1;
        while (taken.has(`${sp.id}.${n}`)) n++;
        const nr = newRace(`${sp.id}.${n}`, `New race`);
        // A new race starts as a copy of the one shown: races vary their species within limits.
        if (r) Object.assign(nr, { size: r.size, stats: { ...r.stats }, fightingAge: r.fightingAge, lifespan: r.lifespan });
        sp.races.push(nr);
        raceSel = sp.races.length - 1;
        changed();
        renderEditor();
      } }, '+ Race'),
    );
    renderMissing();
    return [
      section(
        'Species',
        text('Name', () => sp.name, (v) => (sp.name = v)),
        text('Kind', () => sp.kind, (v) => (sp.kind = v), { list: [...new Set(lib.species.map((s) => s.kind).filter(Boolean))], hint: 'Broad kind: Humanoid, Mammalian, Avian, Reptilian, Fay…' }),
        check('Set aside for later', () => sp.setAside, (v) => (sp.setAside = v), 'Kept here, but not used by the simulation yet.'),
        traitPicker('Traits', 'sentient', () => sp.traits, (v) => (sp.traits = v), 'Fixed traits every race of the species has (a race can lack some).'),
        text('Notes', () => sp.notes, (v) => (sp.notes = v), { long: true }),
      ),
      h(
        'details',
        { class: 'lib-section', open: true },
        h('summary', {}, 'Races'),
        h('p', { class: 'muted small' }, 'Each race is a people within the species, varying it within limits, with its own stats.'),
        raceTabs,
        missingEl,
        r ? raceEditor(sp, r) : h('p', {}, 'No races.'),
        sp.races.length > 1 ? h('button', { type: 'button', class: 'ghost small danger', onclick: () => { sp.races.splice(raceSel, 1); raceSel = 0; changed(); renderEditor(); } }, `Delete the race “${r.name}”`) : null,
      ),
      ...profileSections(sp.profile, true),
      section(
        'Mind and society',
        select('Social structure', SOCIAL, () => sp.social, (v) => (sp.social = v)),
        select('Lifestyle', LIFESTYLES, () => sp.lifestyle, (v) => (sp.lifestyle = v)),
        text('Temperament', () => sp.temperament, (v) => (sp.temperament = v), { list: ['Peaceful', 'Cautious', 'Curious', 'Proud', 'Fierce', 'Aggressive', 'Stoic', 'Playful'] }),
        multi('Building styles', BUILDING, BUILDING, () => sp.building, (v) => (sp.building = v)),
        h('p', { class: 'muted small wide' }, 'Intelligence and learning speed come from the Intelligence stat; magic affinity from each race’s affinities.'),
      ),
      section(
        'War and heroes',
        warSummary(sp),
        text('Racial troop types', () => sp.troops, (v) => (sp.troops = v), { long: true, hint: 'Troops only this people fields (for specialized troops), one per line.' }),
      ),
    ];
  };
  /** What each race's numbers mean for soldiers, from the stats (SPECIES.md, "How the stats translate"). */
  const warSummary = (sp: Species) => {
    const rows = sp.races.map((r) => {
      const s = r.stats;
      const fight = [s.health, s.armor, s.strength, s.agility, s.constitution];
      const known = fight.every((v) => v !== null);
      const hu = 16 + 0 + 10 + 10 + 14;
      return h(
        'tr',
        {},
        h('td', {}, r.name),
        h('td', {}, known ? `${Math.round(((fight as number[]).reduce((a, b) => a + b, 0) / hu) * 100)}%` : '—'),
        h('td', {}, s.willpower === null ? '—' : `${Math.round((s.willpower / 6) * 100)}%`),
        h('td', {}, s.speed === null ? '—' : `${Math.round((s.speed / 30) * 100)}%`),
        h('td', {}, s.mana === null ? '—' : String(s.mana)),
      );
    });
    return h('div', { class: 'field wide' }, h('span', { class: 'label' }, 'Soldiers compared with Humans'), h('table', { class: 'zone-legend small' }, h('thead', {}, h('tr', {}, h('th', {}, 'Race'), h('th', {}, 'Fighting strength'), h('th', {}, 'Morale'), h('th', {}, 'March speed'), h('th', {}, 'Hero mage power'))), h('tbody', {}, ...rows)), h('small', {}, 'Fighting strength from Health, Armour, Strength, Agility and Constitution; morale from Willpower; march speed from Speed.'));
  };

  const beastEditor = (b: Beast) => [
    section(
      'Beast',
      text('Name', () => b.name, (v) => (b.name = v)),
      text('Kind', () => b.kind, (v) => (b.kind = v), { list: [...new Set(lib.beasts.map((x) => x.kind).filter(Boolean))] }),
      select('Size', SIZES, () => b.size ?? '', (v) => (b.size = (v || null) as Beast['size'])),
      num('Lifespan', () => b.lifespan, (v) => (b.lifespan = v), { unit: 'years', min: 0 }),
      statsGrid(b.stats, () => {}),
      traitPicker('Traits', 'beast', () => b.traits, (v) => (b.traits = v)),
      text('Notes', () => b.notes, (v) => (b.notes = v), { long: true }),
    ),
    section(
      'Uses and hunting',
      multi('Uses', BEAST_USES, BEAST_USES, () => b.uses, (v) => (b.uses = v)),
      multi('Resources', lib.resources.map((r) => r.id), lib.resources.map((r) => r.name), () => b.resources, (v) => (b.resources = v), 'What it gives (leather, feathers, horns…).'),
      select('Lives in', HERDING, () => b.herding, (v) => (b.herding = v)),
      scale('Hunting difficulty', () => b.hunting, (v) => (b.hunting = v), ['1 easy', '2', '3', '4', '5 very hard'], 'One massive beast is far harder to bring down than a few deer.'),
      scale('Domestication difficulty', () => b.domestication, (v) => (b.domestication = v), ['1 easy', '2', '3', '4', '5 very hard'], 'A barrier to ranching it.'),
      h('p', { class: 'muted small wide' }, 'Numbers are not counted: the simulation shows each beast as a density map, from none to abundant, where its environment suits it; more hunting means fewer.'),
    ),
    ...profileSections(b.profile, false),
  ];

  const traitEditor = (t: Trait) => {
    const effects = h('div', { class: 'pairs' });
    const renderEffects = () => {
      effects.replaceChildren(
        ...t.effects.map((e, i) => {
          const target = h('select', {}, ...EFFECT_TARGETS.map((o) => h('option', { value: o }, o))) as HTMLSelectElement;
          target.value = e.target;
          target.addEventListener('change', () => {
            e.target = target.value;
            changed();
          });
          const amount = h('input', { type: 'number', step: 1, value: e.amount }) as HTMLInputElement;
          amount.addEventListener('input', () => {
            if (Number.isFinite(amount.valueAsNumber)) {
              e.amount = amount.valueAsNumber;
              changed();
            }
          });
          return h('div', { class: 'pair-row' }, target, amount, h('button', { type: 'button', class: 'ghost small', 'aria-label': 'Remove', onclick: () => { t.effects.splice(i, 1); changed(); renderEffects(); } }, '×'));
        }),
        h('button', { type: 'button', class: 'ghost small', onclick: () => { t.effects.push({ target: EFFECT_TARGETS[0], amount: 1 }); changed(); renderEffects(); } }, '+ Effect'),
      );
    };
    renderEffects();
    const users = [...lib.species.filter((s) => s.traits.includes(t.id) || s.races.some((r) => r.addTraits.includes(t.id))).map((s) => s.name), ...lib.beasts.filter((b) => b.traits.includes(t.id)).map((b) => b.name)];
    return [
      section(
        'Trait',
        text('Name', () => t.name, (v) => (t.name = v)),
        multi('For', ['sentient', 'beast'] as const, ['Peoples', 'Beasts'], () => t.for, (v) => (t.for = v)),
        text('What it means', () => t.description, (v) => (t.description = v), { long: true }),
        h('div', { class: 'field wide' }, h('span', { class: 'label' }, 'Effects'), effects, h('small', {}, 'Stats change by points; (%) targets by percent; yes/no abilities use 1.')),
        h('p', { class: 'muted small wide' }, users.length ? `Used by: ${users.join(', ')}.` : 'Not used by anyone yet.'),
      ),
    ];
  };

  const resourceEditor = (r: Resource) => {
    const users = lib.beasts.filter((b) => b.resources.includes(r.id)).map((b) => b.name);
    return [
      section(
        'Resource',
        text('Name', () => r.name, (v) => (r.name = v)),
        select('Category', RESOURCE_CATEGORIES, () => r.category, (v) => (r.category = v)),
        select('Comes from', RESOURCE_SOURCES, () => r.source, (v) => (r.source = v)),
        select('Rarity', RARITIES, () => r.rarity, (v) => (r.rarity = v)),
        text('Description', () => r.description, (v) => (r.description = v), { long: true }),
        h('p', { class: 'muted small wide' }, users.length ? `Given by: ${users.join(', ')}.` : 'No beast gives it.'),
      ),
      section(
        'Where it is found',
        multi('Climates', ZONE_INFO.map((_, i) => i), ZONE_NAMES, () => r.climates, (v) => (r.climates = v), 'Empty: any climate.'),
        multi('Ground cover', COVER_BRUSHES, COVER_BRUSHES.map(coverName), () => r.covers, (v) => (r.covers = v), 'Empty: any ground.'),
        multi('Terrain', TERRAINS, TERRAINS, () => r.terrain, (v) => (r.terrain = v)),
      ),
    ];
  };

  const techEditor = (t: Tech) => {
    const tier = techTiers(lib.techs).get(t.id) ?? 0;
    const neededBy = lib.techs.filter((x) => x.requires.includes(t.id)).map((x) => x.name);
    return [
      section(
        'Technology',
        text('Name', () => t.name, (v) => (t.name = v)),
        select('Field', TECH_FIELDS, () => t.field, (v) => (t.field = v)),
        check('Known from the start', () => t.start, (v) => (t.start = v), 'Every people begins with it.'),
        scale('Difficulty', () => t.difficulty, (v) => (t.difficulty = v), ['1 easy', '2', '3', '4', '5 very hard']),
        text('Description', () => t.description, (v) => (t.description = v), { long: true }),
        refs('Needs first', () => techOpts(t.id), () => t.requires, (v) => (t.requires = v), `Level ${tier + 1} in its tree: one more than the deepest technology it needs.`),
        refs('Needs resources', resourceOpts, () => t.resources, (v) => (t.resources = v), 'Bronze needs copper and tin.'),
        multi('Needs places', PLACES, PLACES, () => t.places, (v) => (t.places = v), 'Sailing needs water.'),
        text('Practice that leads to it', () => t.practice, (v) => (t.practice = v), { hint: 'What people do that brings it about (discovery is by practice, need and contact).' }),
        text('Need that pushes it', () => t.need, (v) => (t.need = v)),
        text('What it makes possible', () => t.unlocks, (v) => (t.unlocks = v), { long: true }),
        h('p', { class: 'muted small wide' }, neededBy.length ? `Needed by: ${neededBy.join(', ')}.` : 'Nothing needs it yet.'),
      ),
    ];
  };
  const behaviourEditor = (b: Behaviour) => {
    const known = lib.cultures.filter((c) => c.behaviours.includes(b.id)).map((c) => c.name);
    return [
      section(
        'Learned behaviour',
        text('Name', () => b.name, (v) => (b.name = v)),
        select('Category', BEHAVIOUR_CATEGORIES, () => b.category, (v) => (b.category = v)),
        text('Description', () => b.description, (v) => (b.description = v), { long: true }),
        refs('Needs first', () => behaviourOpts(b.id), () => b.requires, (v) => (b.requires = v)),
        refs('Needs technology', () => techOpts(), () => b.needsTech, (v) => (b.needsTech = v)),
        refs('Pushes technology forward', () => techOpts(), () => b.pushesTech, (v) => (b.pushesTech = v)),
        text('What it unlocks', () => b.unlocks, (v) => (b.unlocks = v), { long: true, hint: 'Ways of living, government parts, buildings.' }),
        h('p', { class: 'muted small wide' }, 'Spreads by practice, need and contact (contact much faster).', known.length ? ` Known from the start by: ${known.join(', ')}.` : ''),
      ),
    ];
  };
  const traditionEditor = (t: Tradition) => {
    const levels = h('div', { class: 'pairs' });
    const renderLevels = () => {
      levels.replaceChildren(
        ...t.levels.map((l, i) => {
          const name = h('input', { type: 'text', value: l.name, placeholder: 'Degree', 'aria-label': 'Degree name' }) as HTMLInputElement;
          name.addEventListener('input', () => { l.name = name.value; changed(); });
          const desc = h('input', { type: 'text', value: l.description, placeholder: 'What it means at this degree', class: 'grow', 'aria-label': 'What it means' }) as HTMLInputElement;
          desc.addEventListener('input', () => { l.description = desc.value; changed(); });
          return h('div', { class: 'pair-row' }, h('span', { class: 'muted small' }, `${i + 1}.`), name, desc, t.levels.length > 1 ? h('button', { type: 'button', class: 'ghost small', 'aria-label': 'Remove', onclick: () => { t.levels.splice(i, 1); changed(); renderLevels(); } }, '×') : null);
        }),
        h('button', { type: 'button', class: 'ghost small', onclick: () => { t.levels.push({ name: '', description: '' }); changed(); renderLevels(); } }, '+ Degree'),
      );
    };
    renderLevels();
    const held = lib.cultures.filter((c) => c.traditions.some((x) => x.id === t.id)).map((c) => c.name);
    return [
      section(
        'Tradition',
        text('Name', () => t.name, (v) => (t.name = v)),
        select('Category', TRADITION_CATEGORIES, () => t.category, (v) => (t.category = v)),
        text('Description', () => t.description, (v) => (t.description = v), { long: true }),
        h('div', { class: 'field wide' }, h('span', { class: 'label' }, 'Degrees of severity (mildest first)'), levels, h('small', {}, 'Severity rises or falls over generations as the people lives that life more or less.')),
        text('How it is earned', () => t.conditions, (v) => (t.conditions = v), { long: true, hint: 'Living that life long enough earns it; leaving it fades it.' }),
        multi('Needs places', PLACES, PLACES, () => t.places, (v) => (t.places = v)),
        refs('Needs beasts', () => lib.beasts.map((x) => ({ id: x.id, name: x.name, group: x.kind || 'Other' })), () => t.beasts, (v) => (t.beasts = v), 'Horse Lords need horses (or another mount).'),
        text('Effects', () => t.effects, (v) => (t.effects = v), { long: true }),
        h('p', { class: 'muted small wide' }, held.length ? `Held by: ${held.join(', ')}.` : 'No culture holds it yet.'),
      ),
    ];
  };
  const cultureEditor = (c: Culture) => {
    const raceOpts = (): Opt[] => lib.species.flatMap((sp) => sp.races.map((r) => ({ id: r.id, name: r.name, group: sp.name })));
    // Traditions: about six, each at a degree, locked or encouraged for story cultures.
    const trBox = h('div', { class: 'pairs' });
    const count = h('small', {});
    const renderTr = () => {
      count.textContent = `${c.traditions.length} of about 6.${c.traditions.length > 6 ? ' More than six: a culture usually holds about six (specialties don’t count).' : ''}`;
      trBox.replaceChildren(
        ...c.traditions.map((ct, i) => {
          const def = lib.traditions.find((t) => t.id === ct.id);
          const pick = h('select', { 'aria-label': 'Tradition' }, ...TRADITION_CATEGORIES.map((cat) => h('optgroup', { label: cat }, ...lib.traditions.filter((t) => t.category === cat).map((t) => h('option', { value: t.id }, t.name)))), h('optgroup', { label: 'Other' }, ...lib.traditions.filter((t) => !(TRADITION_CATEGORIES as readonly string[]).includes(t.category)).map((t) => h('option', { value: t.id }, t.name)))) as HTMLSelectElement;
          pick.value = ct.id;
          pick.addEventListener('change', () => { ct.id = pick.value; ct.level = 0; changed(); renderTr(); });
          const lvl = h('select', { 'aria-label': 'Degree' }, ...(def?.levels ?? []).map((l, j) => h('option', { value: String(j) }, l.name || `Degree ${j + 1}`))) as HTMLSelectElement;
          lvl.value = String(Math.min(ct.level, Math.max(0, (def?.levels.length ?? 1) - 1)));
          lvl.addEventListener('change', () => { ct.level = Number(lvl.value); changed(); renderTr(); });
          const hold = h('select', { 'aria-label': 'Locked or encouraged' }, h('option', { value: '' }, 'Free'), h('option', { value: 'Encouraged' }, 'Heavily encouraged'), h('option', { value: 'Locked' }, 'Locked')) as HTMLSelectElement;
          hold.value = ct.hold;
          hold.addEventListener('change', () => { ct.hold = hold.value; changed(); });
          const desc = def?.levels[Math.min(ct.level, def.levels.length - 1)]?.description;
          return h('div', { class: 'tradition-row' }, h('div', { class: 'pair-row' }, pick, lvl, hold, h('button', { type: 'button', class: 'ghost small', 'aria-label': 'Remove', onclick: () => { c.traditions.splice(i, 1); changed(); renderTr(); } }, '×')), desc ? h('small', { class: 'muted' }, desc) : null);
        }),
        ...(lib.traditions.length ? [h('button', { type: 'button', class: 'ghost small', onclick: () => { const free = lib.traditions.find((t) => !c.traditions.some((x) => x.id === t.id)); if (free) { c.traditions.push({ id: free.id, level: 0, hold: '' }); changed(); renderTr(); } } }, '+ Tradition')] : []),
      );
    };
    renderTr();
    const spBox = h('div', { class: 'pairs' });
    const renderSp = () => {
      spBox.replaceChildren(
        ...c.specialties.map((sp, i) => {
          const name = h('input', { type: 'text', value: sp.name, placeholder: 'Name (e.g. Rift tide fear)', 'aria-label': 'Specialty name' }) as HTMLInputElement;
          name.addEventListener('input', () => { sp.name = name.value; changed(); });
          const desc = h('input', { type: 'text', value: sp.description, placeholder: 'What they remember, and what they do because of it', class: 'grow', 'aria-label': 'Specialty' }) as HTMLInputElement;
          desc.addEventListener('input', () => { sp.description = desc.value; changed(); });
          return h('div', { class: 'pair-row' }, name, desc, h('button', { type: 'button', class: 'ghost small', 'aria-label': 'Remove', onclick: () => { c.specialties.splice(i, 1); changed(); renderSp(); } }, '×'));
        }),
        h('button', { type: 'button', class: 'ghost small', onclick: () => { c.specialties.push({ name: '', description: '' }); changed(); renderSp(); } }, '+ Specialty'),
      );
    };
    renderSp();
    // Behaviours known at the start, and any they need that are missing.
    const missing = () => {
      const have = new Set(c.behaviours);
      const need = new Set<string>();
      for (const id of c.behaviours) for (const r of lib.behaviours.find((b) => b.id === id)?.requires ?? []) if (!have.has(r)) need.add(r);
      return nameIn(lib.behaviours, [...need]);
    };
    const missingNote = h('small', {});
    const showMissing = () => {
      const m = missing();
      missingNote.textContent = m.length ? `Also needs: ${m.join(', ')}.` : 'Learned behaviours spread later by practice, need and contact.';
    };
    showMissing();
    return [
      section(
        'Pillars',
        text('Name', () => c.name, (v) => (c.name = v)),
        refs('Heritage: species', () => lib.species.map((sp) => ({ id: sp.id, name: sp.name, group: sp.kind || 'Other' })), () => c.species, (v) => (c.species = v), 'A culture can span races and species; shared heritage eases acceptance.'),
        refs('Heritage: races', raceOpts, () => c.races, (v) => (c.races = v)),
        text('Ancestral group', () => c.ancestry, (v) => (c.ancestry = v), { hint: 'The people it descends from.' }),
        text('Language', () => c.language, (v) => (c.language = v), { hint: 'Shared language eases acceptance.' }),
        text('Language sounds', () => c.sounds, (v) => (c.sounds = v), { long: true, hint: 'Word parts and example names, for naming places later (e.g. “-dor, -heim, ka-, Valdor, Kahheim”).' }),
        select('Ethos', ETHOS, () => c.ethos, (v) => (c.ethos = v), { hint: 'Its core outlook.' }),
        select('Martial custom', MARTIAL, () => c.martial, (v) => (c.martial = v), { hint: 'Who fights.' }),
        multi('Lifestyle', CULTURE_LIFESTYLES, CULTURE_LIFESTYLES, () => c.lifestyles, (v) => (c.lifestyles = v), 'From the environment; can blend.'),
      ),
      h('details', { class: 'lib-section', open: true }, h('summary', {}, 'Traditions'), h('p', { class: 'muted small' }, 'About six, earned from how the people survives where it lives. Story cultures can lock a tradition or heavily encourage it.'), trBox, count),
      h('details', { class: 'lib-section', open: true }, h('summary', {}, 'Specialties'), h('p', { class: 'muted small' }, 'Shared memories and their customs, on top of the six (they never take a tradition’s place). Mostly flavour.'), spBox),
      section(
        'Learned behaviours',
        refs('Known from the start', () => behaviourOpts(), () => c.behaviours, (v) => { c.behaviours = v; showMissing(); }),
        h('div', { class: 'wide' }, missingNote),
      ),
      section(
        'Government',
        select('Preferred government', lib.governments.map((gv) => gv.id), () => c.government, (v) => (c.government = v), { names: lib.governments.map((gv) => (gv.builtIn ? gv.name : `${gv.name} (made)`)), blank: 'None preferred', hint: 'Built-in types, or one made in the Governments tab for this culture.' }),
        select('How firmly', ['Strong pull', 'Locked'], () => c.governmentHold, (v) => (c.governmentHold = v), { blank: 'Free to change', hint: 'Locked: always keeps it (only the details change). Strong pull: can change under pressure but tends to return.' }),
      ),
      section('Notes', text('Notes', () => c.notes, (v) => (c.notes = v), { long: true })),
    ];
  };
  /** Rows of named items (degrees, holy sites): each a name and a description, with an optional kind. */
  const rowsEditor = (rows: { name: string; description: string; kind?: string }[], opts: { namePh: string; descPh: string; kinds?: readonly string[]; add: string; min?: number }) => {
    const box = h('div', { class: 'pairs' });
    const render = () => {
      box.replaceChildren(
        ...rows.map((row, i) => {
          const name = h('input', { type: 'text', value: row.name, placeholder: opts.namePh, 'aria-label': opts.namePh }) as HTMLInputElement;
          name.addEventListener('input', () => { row.name = name.value; changed(); });
          const kind = opts.kinds ? (h('select', { 'aria-label': 'Kind' }, h('option', { value: '' }, 'Kind…'), ...opts.kinds.map((k) => h('option', { value: k }, k))) as HTMLSelectElement) : null;
          if (kind) {
            kind.value = row.kind ?? '';
            kind.addEventListener('change', () => { row.kind = kind.value; changed(); });
          }
          const desc = h('input', { type: 'text', value: row.description, placeholder: opts.descPh, class: 'grow', 'aria-label': opts.descPh }) as HTMLInputElement;
          desc.addEventListener('input', () => { row.description = desc.value; changed(); });
          return h('div', { class: 'pair-row' }, h('span', { class: 'muted small' }, `${i + 1}.`), name, kind, desc, rows.length > (opts.min ?? 0) ? h('button', { type: 'button', class: 'ghost small', 'aria-label': 'Remove', onclick: () => { rows.splice(i, 1); changed(); render(); } }, '×') : null);
        }),
        h('button', { type: 'button', class: 'ghost small', onclick: () => { rows.push(opts.kinds ? { name: '', kind: '', description: '' } : { name: '', description: '' }); changed(); render(); } }, opts.add),
      );
    };
    render();
    return box;
  };
  const governmentEditor = (gv: Government) => {
    const users = lib.cultures.filter((c) => c.government === gv.id).map((c) => c.name);
    return [
      section(
        'Government',
        text('Name', () => gv.name, (v) => (gv.name = v)),
        check('Built-in type', () => gv.builtIn, (v) => (gv.builtIn = v), 'The AI turns to built-in types under their conditions; governments you make are for the cultures you give them to.'),
        text('Description', () => gv.description, (v) => (gv.description = v), { long: true }),
      ),
      section(
        'Parts',
        select('Head of state', GOV_HEAD, () => gv.head, (v) => (gv.head = v)),
        select('Who holds the land', GOV_LAND, () => gv.land, (v) => (gv.land = v)),
        select('Succession', GOV_SUCCESSION, () => gv.succession, (v) => (gv.succession = v)),
        select('Legitimacy', GOV_LEGITIMACY, () => gv.legitimacy, (v) => (gv.legitimacy = v)),
        select('Law', GOV_LAW, () => gv.law, (v) => (gv.law = v)),
        multi('Ruling class', GOV_RULING, GOV_RULING, () => gv.ruling, (v) => (gv.ruling = v), 'Who is set up in the government as its rulers, not merely who has influence.'),
        multi('Army', GOV_ARMY, GOV_ARMY, () => gv.army, (v) => (gv.army = v)),
        h('p', { class: 'muted small wide' }, 'High princes: the highest nobles under the king, where a ruling family’s hold stays strong even after its own king’s defeat. Centralization is not set here: it is the realm’s real ability to enforce its laws, and changes in the simulation.'),
      ),
      section(
        'When it can be used',
        refs('Needs learned behaviours', () => behaviourOpts(), () => gv.needs, (v) => (gv.needs = v), 'A people must know these first (feudal kingdoms need feudal oaths).'),
        text('Conditions', () => gv.conditions, (v) => (gv.conditions = v), { long: true, hint: 'When the AI turns to it (e.g. a strong clergy faction toward theocracy, dense mana and towers toward magocracy).' }),
        text('Notes', () => gv.notes, (v) => (gv.notes = v), { long: true }),
        h('p', { class: 'muted small wide' }, users.length ? `Preferred by: ${users.join(', ')}.` : 'No culture prefers it yet.'),
      ),
    ];
  };
  const tenetEditor = (t: Tenet) => {
    const held = lib.faiths.filter((f) => f.tenets.some((x) => x.id === t.id)).map((f) => f.name);
    return [
      section(
        'Tenet',
        text('Name', () => t.name, (v) => (t.name = v)),
        text('Description', () => t.description, (v) => (t.description = v), { long: true }),
        h('div', { class: 'field wide' }, h('span', { class: 'label' }, 'Degrees of severity (mildest first)'), rowsEditor(t.levels, { namePh: 'Degree', descPh: 'What it means at this degree', add: '+ Degree', min: 1 })),
        text('Effects', () => t.effects, (v) => (t.effects = v), { long: true }),
        h('p', { class: 'muted small wide' }, held.length ? `Held by: ${held.join(', ')}.` : 'No faith holds it yet.'),
      ),
    ];
  };
  const faithEditor = (f: Faith) => {
    const tBox = h('div', { class: 'pairs' });
    const count = h('small', {});
    const renderT = () => {
      count.textContent = `${f.tenets.length} of about 3.`;
      tBox.replaceChildren(
        ...f.tenets.map((ft, i) => {
          const def = lib.tenets.find((t) => t.id === ft.id);
          const pick = h('select', { 'aria-label': 'Tenet' }, ...lib.tenets.map((t) => h('option', { value: t.id }, t.name))) as HTMLSelectElement;
          pick.value = ft.id;
          pick.addEventListener('change', () => { ft.id = pick.value; ft.level = 0; changed(); renderT(); });
          const lvl = h('select', { 'aria-label': 'Degree' }, ...(def?.levels ?? []).map((l, j) => h('option', { value: String(j) }, l.name || `Degree ${j + 1}`))) as HTMLSelectElement;
          lvl.value = String(Math.min(ft.level, Math.max(0, (def?.levels.length ?? 1) - 1)));
          lvl.addEventListener('change', () => { ft.level = Number(lvl.value); changed(); renderT(); });
          const desc = def?.levels[Math.min(ft.level, def.levels.length - 1)]?.description;
          return h('div', { class: 'tradition-row' }, h('div', { class: 'pair-row' }, pick, lvl, h('button', { type: 'button', class: 'ghost small', 'aria-label': 'Remove', onclick: () => { f.tenets.splice(i, 1); changed(); renderT(); } }, '×')), desc ? h('small', { class: 'muted' }, desc) : null);
        }),
        ...(lib.tenets.length ? [h('button', { type: 'button', class: 'ghost small', onclick: () => { const free = lib.tenets.find((t) => !f.tenets.some((x) => x.id === t.id)); if (free) { f.tenets.push({ id: free.id, level: 0 }); changed(); renderT(); } } }, '+ Tenet')] : []),
      );
    };
    renderT();
    return [
      section(
        'Identity',
        text('Name', () => f.name, (v) => (f.name = v)),
        text('Symbols', () => f.symbols, (v) => (f.symbols = v)),
        refs('Followers: cultures', () => lib.cultures.map((c) => ({ id: c.id, name: c.name })), () => f.cultures, (v) => (f.cultures = v)),
        refs('Followers: species', () => lib.species.map((sp) => ({ id: sp.id, name: sp.name, group: sp.kind || 'Other' })), () => f.species, (v) => (f.species = v)),
        multi('Nature of belief', BELIEF_NATURE, BELIEF_NATURE, () => f.nature, (v) => (f.nature = v), 'One, or a mix.'),
        select('Story faith', ['Encouraged', 'Locked'], () => f.hold, (v) => (f.hold = v), { blank: 'Free', names: ['Heavily encouraged', 'Locked'], hint: 'Story faiths can be locked or heavily encouraged for their followers.' }),
      ),
      h('details', { class: 'lib-section', open: true }, h('summary', {}, 'Tenets'), h('p', { class: 'muted small' }, 'About three core beliefs, each at a degree.'), tBox, count),
      section(
        'Doctrines',
        select('Who leads', FAITH_LEADERS, () => f.leader, (v) => (f.leader = v)),
        select('Who can be clergy', FAITH_CLERGY, () => f.clergy, (v) => (f.clergy = v)),
        select('Other faiths', FAITH_TOLERANCE, () => f.otherFaiths, (v) => (f.otherFaiths = v)),
        select('Marriage', FAITH_MARRIAGE, () => f.marriage, (v) => (f.marriage = v)),
        select('Other species', FAITH_TOLERANCE, () => f.otherSpecies, (v) => (f.otherSpecies = v)),
        select('Mana', FAITH_MANA, () => f.mana, (v) => (f.mana = v)),
        select('Organization at the start', FAITH_ORGANIZATION, () => f.organization, (v) => (f.organization = v), { hint: 'It grows with culture and technology, from local shamans to a head of faith.' }),
      ),
      h('details', { class: 'lib-section', open: true }, h('summary', {}, 'Holy sites'), h('p', { class: 'muted small' }, 'Holding them strengthens the faith; losing them hurts. (They are placed on the map in a later phase.)'), rowsEditor(f.holySites, { namePh: 'Name', descPh: 'What it is and why it is holy', kinds: HOLY_SITE_KINDS, add: '+ Holy site' })),
      section(
        'Gods',
        refs('Gods worshipped', () => lib.gods.map((gd) => ({ id: gd.id, name: gd.name })), () => f.gods, (v) => (f.gods = v), lib.gods.length ? undefined : 'Make gods in the Gods tab.'),
        text('Notes', () => f.notes, (v) => (f.notes = v), { long: true }),
      ),
    ];
  };
  const godEditor = (gd: God) => {
    const faiths = lib.faiths.filter((f) => f.gods.includes(gd.id)).map((f) => f.name);
    const others = () => lib.gods.filter((x) => x.id !== gd.id).map((x) => ({ id: x.id, name: x.name }));
    return [
      section(
        'God',
        text('Name', () => gd.name, (v) => (gd.name = v)),
        text('Titles', () => gd.titles, (v) => (gd.titles = v), { hint: 'E.g. the Hearthmother, Lord of Storms.' }),
        text('Symbol', () => gd.symbol, (v) => (gd.symbol = v)),
        multi('Domains', GOD_DOMAINS, GOD_DOMAINS, () => gd.domains, (v) => (gd.domains = v)),
        select('Personality', GOD_PERSONALITY, () => gd.personality, (v) => (gd.personality = v)),
        text('Goals', () => gd.goals, (v) => (gd.goals = v), { long: true, hint: 'What it wants from the world (a war god nudging its followers toward conflict…). The gods are playing games with the people of the world.' }),
        h('p', { class: 'muted small wide' }, faiths.length ? `Worshipped in: ${faiths.join(', ')}.` : 'Not worshipped by any faith yet.'),
      ),
      section(
        'Favourites, rivals and allies',
        refs('Favoured species', () => lib.species.map((sp) => ({ id: sp.id, name: sp.name, group: sp.kind || 'Other' })), () => gd.favouredSpecies, (v) => (gd.favouredSpecies = v)),
        refs('Favoured cultures', () => lib.cultures.map((c) => ({ id: c.id, name: c.name })), () => gd.favouredCultures, (v) => (gd.favouredCultures = v)),
        refs('Rivals', others, () => gd.rivals, (v) => (gd.rivals = v), 'Gods it competes with, through their followers.'),
        refs('Allies', others, () => gd.allies, (v) => (gd.allies = v)),
      ),
      section(
        'Acting in the world',
        scale('How active', () => gd.activity, (v) => (gd.activity = v), ['1 rarely', '2', '3', '4', '5 often'], 'Alongside the world’s own setting for how active the gods are (World tab).'),
        multi('What it does', GOD_POWERS, GOD_POWERS, () => gd.powers, (v) => (gd.powers = v)),
        text('Notes', () => gd.notes, (v) => (gd.notes = v), { long: true }),
      ),
    ];
  };

  /**
   * Every race in one table, for filling in size, fighting age and lifespan quickly (the numbers
   * most races still lack before the simulation can use them). Full stats are in each species.
   */
  const fillTable = () => {
    const rows = lib.species.filter((sp) => !sp.setAside).flatMap((sp) =>
      sp.races.map((r) => {
        const status = h('td', { class: 'small' });
        const showStatus = () => {
          const m = raceMissing(r);
          status.textContent = m.length ? `Needs ${m.join('; ')}` : 'Ready';
          status.className = m.length ? 'small needs-cell' : 'small ready-cell';
        };
        showStatus();
        const numCell = (get: () => number | null, set: (v: number | null) => void, label: string) => {
          const input = h('input', { type: 'number', min: 0, step: 1, placeholder: '—', 'aria-label': `${r.name}: ${label}` }) as HTMLInputElement;
          input.value = get() === null ? '' : String(get());
          input.addEventListener('input', () => {
            set(input.value.trim() === '' || !Number.isFinite(input.valueAsNumber) ? null : input.valueAsNumber);
            showStatus();
            changed();
          });
          return h('td', {}, input);
        };
        const size = h('select', { 'aria-label': `${r.name}: size` }, h('option', { value: '' }, '—'), ...SIZES.map((z) => h('option', { value: z }, z))) as HTMLSelectElement;
        size.value = r.size ?? '';
        size.addEventListener('change', () => {
          r.size = (size.value || null) as Race['size'];
          showStatus();
          changed();
        });
        return h(
          'tr',
          {},
          h('td', {}, h('button', { type: 'button', class: 'linkish', onclick: () => { selected = sp.id; raceSel = sp.races.indexOf(r); renderList(); renderEditor(); } }, sp.races.length > 1 ? `${sp.name}: ${r.name}` : r.name)),
          h('td', {}, size),
          numCell(() => r.fightingAge, (v) => (r.fightingAge = v), 'fighting age'),
          numCell(() => r.lifespan, (v) => (r.lifespan = v), 'lifespan'),
          status,
        );
      }),
    );
    return h(
      'div',
      { class: 'fill-table' },
      h('h3', {}, 'Fill in quickly'),
      h('p', { class: 'muted small' }, 'Size, fighting age and lifespan for every race. A race takes part in the simulation once it is “Ready”; races without stats need them filled in their species’ page (click the name).'),
      h('table', { class: 'zone-legend' }, h('thead', {}, h('tr', {}, h('th', {}, 'Race'), h('th', {}, 'Size'), h('th', {}, 'Fighting age (years)'), h('th', {}, 'Lifespan (years)'), h('th', {}, ''))), h('tbody', {}, ...rows)),
    );
  };

  /** The technology tree at a glance: a column per field, each line by level. */
  const techTree = () => {
    const tiers = techTiers(lib.techs);
    const fields = [...TECH_FIELDS, ...new Set(lib.techs.map((t) => t.field).filter((f) => f && !(TECH_FIELDS as readonly string[]).includes(f)))];
    return h(
      'div',
      { class: 'tech-tree' },
      ...fields.map((f) => {
        const list = lib.techs.filter((t) => (t.field || '') === f).sort((a, b) => (tiers.get(a.id) ?? 0) - (tiers.get(b.id) ?? 0) || a.name.localeCompare(b.name));
        if (!list.length) return null;
        return h(
          'div',
          { class: 'tech-col' },
          h('h3', {}, f),
          ...list.map((t) =>
            h('button', { type: 'button', class: `tech-chip${t.start ? ' start' : ''}`, onclick: () => { selected = t.id; renderList(); renderEditor(); }, title: t.requires.length ? `Needs ${nameIn(lib.techs, t.requires).join(', ')}` : 'Needs nothing' }, h('span', { class: 'tier' }, String((tiers.get(t.id) ?? 0) + 1)), t.name, t.requires.length ? h('small', {}, nameIn(lib.techs, t.requires).join(', ')) : null),
          ),
        );
      }),
    );
  };

  // ---------------------------------------------------------------------------------------------
  // The list on the left

  const itemsOf = (): { id: string; name: string; group: string; flag?: string }[] => {
    const q = search.toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    if (tab === 'species')
      return lib.species
        .filter((s) => match(s.name) || s.races.some((r) => match(r.name)))
        .map((s) => {
          const need = s.races.filter((r) => raceMissing(r).length).length;
          return { id: s.id, name: s.races.length > 1 ? `${s.name} (${s.races.length})` : s.name, group: s.setAside ? 'Set aside for later' : s.kind || 'Other', flag: need ? `${need} need${need > 1 ? '' : 's'} stats` : undefined };
        });
    if (tab === 'beasts') return lib.beasts.filter((b) => match(b.name)).map((b) => ({ id: b.id, name: b.name, group: b.kind || 'Other' }));
    if (tab === 'traits') return lib.traits.filter((t) => match(t.name)).map((t) => ({ id: t.id, name: t.name, group: t.for.length === 2 ? 'Peoples and beasts' : t.for[0] === 'beast' ? 'Beasts' : 'Peoples' }));
    if (tab === 'techs') {
      const tiers = techTiers(lib.techs);
      return lib.techs.filter((t) => match(t.name)).sort((a, b) => (tiers.get(a.id) ?? 0) - (tiers.get(b.id) ?? 0)).map((t) => ({ id: t.id, name: t.name, group: t.field || 'Other' }));
    }
    if (tab === 'behaviours') return lib.behaviours.filter((b) => match(b.name)).map((b) => ({ id: b.id, name: b.name, group: b.category || 'Other' }));
    if (tab === 'traditions') return lib.traditions.filter((t) => match(t.name)).map((t) => ({ id: t.id, name: t.name, group: t.category || 'Other' }));
    if (tab === 'cultures') return lib.cultures.filter((c) => match(c.name)).map((c) => ({ id: c.id, name: c.name, group: 'Cultures' }));
    if (tab === 'governments') return lib.governments.filter((x) => match(x.name)).map((x) => ({ id: x.id, name: x.name, group: x.builtIn ? 'Built-in types' : 'Made for cultures' }));
    if (tab === 'tenets') return lib.tenets.filter((x) => match(x.name)).map((x) => ({ id: x.id, name: x.name, group: 'Tenets' }));
    if (tab === 'faiths') return lib.faiths.filter((x) => match(x.name)).map((x) => ({ id: x.id, name: x.name, group: 'Faiths' }));
    if (tab === 'gods') return lib.gods.filter((x) => match(x.name)).map((x) => ({ id: x.id, name: x.name, group: 'Gods' }));
    return lib.resources.filter((r) => match(r.name)).map((r) => ({ id: r.id, name: r.name, group: r.category || 'Other' }));
  };
  let listTimer = 0;
  const renderListSoon = () => {
    clearTimeout(listTimer);
    listTimer = window.setTimeout(renderList, 400);
  };
  const renderList = () => {
    const items = itemsOf();
    const groups = new Map<string, typeof items>();
    for (const it of items) groups.set(it.group, [...(groups.get(it.group) ?? []), it]);
    const ul = h(
      'div',
      { class: 'lib-groups' },
      ...[...groups].map(([g, list]) =>
        h('div', { class: 'lib-group' }, h('h3', {}, g), ...list.map((it) => h('button', { type: 'button', class: 'lib-item', 'aria-pressed': it.id === selected ? 'true' : 'false', onclick: () => { selected = it.id; raceSel = 0; renderList(); renderEditor(); } }, it.name, it.flag ? h('span', { class: 'badge', title: it.flag }, it.flag) : null))),
      ),
    );
    const searchBox = h('input', { type: 'search', placeholder: 'Search…', value: search, 'aria-label': 'Search' }) as HTMLInputElement;
    searchBox.addEventListener('input', () => {
      search = searchBox.value;
      const pos = searchBox.selectionStart;
      renderList();
      const again = listEl.querySelector<HTMLInputElement>('input[type=search]');
      again?.focus();
      if (again && pos !== null) again.setSelectionRange(pos, pos);
    });
    const label = { species: 'species', beasts: 'beast', traits: 'trait', resources: 'resource', techs: 'technology', behaviours: 'behaviour', traditions: 'tradition', cultures: 'culture', governments: 'government', tenets: 'tenet', faiths: 'faith', gods: 'god' }[tab];
    listEl.replaceChildren(h('div', { class: 'lib-list-head' }, searchBox, h('button', { type: 'button', class: 'primary small', onclick: addNew }, `+ New ${label}`)), items.length ? ul : h('p', { class: 'muted small' }, 'Nothing here.'));
  };
  const addNew = () => {
    const name = { species: 'New species', beasts: 'New beast', traits: 'New trait', resources: 'New resource', techs: 'New technology', behaviours: 'New behaviour', traditions: 'New tradition', cultures: 'New culture', governments: 'New government', tenets: 'New tenet', faiths: 'New faith', gods: 'New god' }[tab];
    const addTo = <T extends { id: string }>(list: T[], make: (id: string) => T) => {
      const id = makeId(name, new Set(list.map((s) => s.id)));
      list.push(make(id));
      selected = id;
    };
    if (tab === 'techs') addTo(lib.techs, (id) => newTech(id, name));
    else if (tab === 'behaviours') addTo(lib.behaviours, (id) => newBehaviour(id, name));
    else if (tab === 'traditions') addTo(lib.traditions, (id) => newTradition(id, name));
    else if (tab === 'cultures') addTo(lib.cultures, (id) => newCulture(id, name));
    else if (tab === 'governments') addTo(lib.governments, (id) => newGovernment(id, name));
    else if (tab === 'tenets') addTo(lib.tenets, (id) => newTenet(id, name));
    else if (tab === 'faiths') addTo(lib.faiths, (id) => newFaith(id, name));
    else if (tab === 'gods') addTo(lib.gods, (id) => newGod(id, name));
    else if (tab === 'species') {
      const id = makeId(name, new Set(lib.species.map((s) => s.id)));
      lib.species.push(newSpecies(id, name));
      selected = id;
    } else if (tab === 'beasts') {
      const id = makeId(name, new Set(lib.beasts.map((s) => s.id)));
      lib.beasts.push(newBeast(id, name));
      selected = id;
    } else if (tab === 'traits') {
      const id = makeId(name, new Set(lib.traits.map((s) => s.id)));
      lib.traits.push(newTrait(id, name));
      selected = id;
    } else {
      const id = makeId(name, new Set(lib.resources.map((s) => s.id)));
      lib.resources.push(newResource(id, name));
      selected = id;
    }
    raceSel = 0;
    changed();
    renderList();
    renderEditor();
  };
  const remove = () => {
    if (!selected) return;
    const id = selected;
    if (tab === 'species') lib.species = lib.species.filter((s) => s.id !== id);
    if (tab === 'beasts') lib.beasts = lib.beasts.filter((s) => s.id !== id);
    if (tab === 'traits') {
      lib.traits = lib.traits.filter((s) => s.id !== id);
      // Nobody keeps a trait that is gone.
      for (const s of lib.species) {
        s.traits = s.traits.filter((x) => x !== id);
        for (const r of s.races) {
          r.addTraits = r.addTraits.filter((x) => x !== id);
          r.removeTraits = r.removeTraits.filter((x) => x !== id);
        }
      }
      for (const b of lib.beasts) b.traits = b.traits.filter((x) => x !== id);
    }
    if (tab === 'resources') {
      lib.resources = lib.resources.filter((s) => s.id !== id);
      for (const b of lib.beasts) b.resources = b.resources.filter((x) => x !== id);
      for (const t of lib.techs) t.resources = t.resources.filter((x) => x !== id);
    }
    if (tab === 'techs') {
      lib.techs = lib.techs.filter((s) => s.id !== id);
      for (const t of lib.techs) t.requires = t.requires.filter((x) => x !== id);
      for (const b of lib.behaviours) {
        b.needsTech = b.needsTech.filter((x) => x !== id);
        b.pushesTech = b.pushesTech.filter((x) => x !== id);
      }
    }
    if (tab === 'behaviours') {
      lib.behaviours = lib.behaviours.filter((s) => s.id !== id);
      for (const b of lib.behaviours) b.requires = b.requires.filter((x) => x !== id);
      for (const c of lib.cultures) c.behaviours = c.behaviours.filter((x) => x !== id);
    }
    if (tab === 'traditions') {
      lib.traditions = lib.traditions.filter((s) => s.id !== id);
      for (const c of lib.cultures) c.traditions = c.traditions.filter((x) => x.id !== id);
    }
    if (tab === 'cultures') {
      lib.cultures = lib.cultures.filter((s) => s.id !== id);
      for (const f of lib.faiths) f.cultures = f.cultures.filter((x) => x !== id);
      for (const gd of lib.gods) gd.favouredCultures = gd.favouredCultures.filter((x) => x !== id);
    }
    if (tab === 'governments') {
      lib.governments = lib.governments.filter((s) => s.id !== id);
      for (const c of lib.cultures) if (c.government === id) c.government = '';
    }
    if (tab === 'tenets') {
      lib.tenets = lib.tenets.filter((s) => s.id !== id);
      for (const f of lib.faiths) f.tenets = f.tenets.filter((x) => x.id !== id);
    }
    if (tab === 'faiths') lib.faiths = lib.faiths.filter((s) => s.id !== id);
    if (tab === 'gods') {
      lib.gods = lib.gods.filter((s) => s.id !== id);
      for (const f of lib.faiths) f.gods = f.gods.filter((x) => x !== id);
      for (const gd of lib.gods) {
        gd.rivals = gd.rivals.filter((x) => x !== id);
        gd.allies = gd.allies.filter((x) => x !== id);
      }
    }
    if (tab === 'behaviours') for (const gv of lib.governments) gv.needs = gv.needs.filter((x) => x !== id);
    if (tab === 'species') for (const c of lib.cultures) c.species = c.species.filter((x) => x !== id);
    selected = null;
    changed();
    renderList();
    renderEditor();
  };
  const duplicate = () => {
    if (!selected) return;
    const copy = <T extends { id: string; name: string }>(list: T[]): T[] => {
      const it = list.find((x) => x.id === selected);
      if (!it) return list;
      const c = JSON.parse(JSON.stringify(it)) as T;
      c.name = `${it.name} (copy)`;
      c.id = makeId(c.name, new Set(list.map((x) => x.id)));
      if ('races' in c) (c as unknown as Species).races.forEach((r, i) => (r.id = `${c.id}.${i + 1}`));
      selected = c.id;
      return [...list, c];
    };
    if (tab === 'species') lib.species = copy(lib.species);
    if (tab === 'beasts') lib.beasts = copy(lib.beasts);
    if (tab === 'traits') lib.traits = copy(lib.traits);
    if (tab === 'resources') lib.resources = copy(lib.resources);
    if (tab === 'techs') lib.techs = copy(lib.techs);
    if (tab === 'behaviours') lib.behaviours = copy(lib.behaviours);
    if (tab === 'traditions') lib.traditions = copy(lib.traditions);
    if (tab === 'cultures') lib.cultures = copy(lib.cultures);
    if (tab === 'governments') {
      lib.governments = copy(lib.governments);
      const made = lib.governments.find((x) => x.id === selected);
      if (made) made.builtIn = false;
    }
    if (tab === 'tenets') lib.tenets = copy(lib.tenets);
    if (tab === 'faiths') lib.faiths = copy(lib.faiths);
    if (tab === 'gods') lib.gods = copy(lib.gods);
    changed();
    renderList();
    renderEditor();
  };

  const renderEditor = () => {
    fid = 0;
    let body: HTMLElement[] = [];
    let title = '';
    if (selected) {
      if (tab === 'species') {
        const sp = lib.species.find((s) => s.id === selected);
        if (sp) [title, body] = [sp.name, speciesEditor(sp)];
      } else if (tab === 'beasts') {
        const b = lib.beasts.find((s) => s.id === selected);
        if (b) [title, body] = [b.name, beastEditor(b)];
      } else if (tab === 'traits') {
        const t = lib.traits.find((s) => s.id === selected);
        if (t) [title, body] = [t.name, traitEditor(t)];
      } else if (tab === 'techs') {
        const t = lib.techs.find((s) => s.id === selected);
        if (t) [title, body] = [t.name, techEditor(t)];
      } else if (tab === 'behaviours') {
        const b = lib.behaviours.find((s) => s.id === selected);
        if (b) [title, body] = [b.name, behaviourEditor(b)];
      } else if (tab === 'traditions') {
        const t = lib.traditions.find((s) => s.id === selected);
        if (t) [title, body] = [t.name, traditionEditor(t)];
      } else if (tab === 'cultures') {
        const c = lib.cultures.find((s) => s.id === selected);
        if (c) [title, body] = [c.name, cultureEditor(c)];
      } else if (tab === 'governments') {
        const x = lib.governments.find((s) => s.id === selected);
        if (x) [title, body] = [x.name, governmentEditor(x)];
      } else if (tab === 'tenets') {
        const x = lib.tenets.find((s) => s.id === selected);
        if (x) [title, body] = [x.name, tenetEditor(x)];
      } else if (tab === 'faiths') {
        const x = lib.faiths.find((s) => s.id === selected);
        if (x) [title, body] = [x.name, faithEditor(x)];
      } else if (tab === 'gods') {
        const x = lib.gods.find((s) => s.id === selected);
        if (x) [title, body] = [x.name, godEditor(x)];
      } else {
        const r = lib.resources.find((s) => s.id === selected);
        if (r) [title, body] = [r.name, resourceEditor(r)];
      }
    }
    if (!body.length && tab === 'techs') {
      editor.replaceChildren(h('div', { class: 'lib-editor-head' }, h('h2', {}, 'Technology tree')), h('p', { class: 'muted' }, 'Fields of levelled lines, not eras. The number is a technology’s level: one more than the deepest one it needs. Highlighted ones are known from the start. Pick one to change it.'), techTree());
      return;
    }
    const intro: Partial<Record<Tab, [string, string, string]>> = {
      governments: ['Governments', 'Governments are built from parts: head of state, ruling class, who holds the land, succession, legitimacy, army and law.', 'The built-in types are what the AI uses under their conditions. Make your own (or duplicate a built-in one) for the cultures you choose to give them to; set a culture’s preferred government in the Cultures tab.'],
      faiths: ['Faiths', 'Faiths are set from the beginning (not formed during the simulation). Each has an identity and followers, its nature of belief, about three tenets, doctrines, holy sites and the gods it worships.', 'Use “+ New faith” to make one. Faiths work as belief whether or not a god acts.'],
      gods: ['Gods', 'The gods are real, and they are playing games with the people of the world. Each is an actor with its own personality, goals, favoured peoples and rivalries; some act often, others rarely.', 'Use “+ New god” to make one. How active the gods are overall (or whether they act at all) is a world setting, in the World tab.'],
    };
    const it = intro[tab];
    if (!body.length && it && (tab === 'governments' || !(tab === 'faiths' ? lib.faiths.length : lib.gods.length))) {
      editor.replaceChildren(h('div', { class: 'lib-empty' }, h('h2', {}, it[0]), h('p', {}, it[1]), h('p', { class: 'muted' }, it[2])));
      return;
    }
    if (!body.length && tab === 'cultures' && !lib.cultures.length) {
      editor.replaceChildren(h('div', { class: 'lib-empty' }, h('h2', {}, 'Cultures'), h('p', {}, 'No cultures yet. A culture belongs to a group of people, not to biology: one race can have several cultures, and a culture can span races.'), h('p', { class: 'muted' }, 'Each has pillars (heritage, language, ethos, martial custom, lifestyle), about six traditions with their severity, specialties, the learned behaviours it starts with, and the government it prefers. Use “+ New culture” to make one.')));
      return;
    }
    if (!body.length) {
      const counts = `${lib.species.length} species (${lib.species.reduce((n, s) => n + s.races.length, 0)} races), ${lib.beasts.length} beasts, ${lib.traits.length} traits, ${lib.resources.length} resources, ${lib.techs.length} technologies, ${lib.behaviours.length} learned behaviours, ${lib.traditions.length} traditions, ${lib.cultures.length} cultures, ${lib.governments.length} governments, ${lib.faiths.length} faiths, ${lib.tenets.length} tenets, ${lib.gods.length} gods.`;
      const needing = lib.species.flatMap((s) => s.races.filter((r) => raceMissing(r).length).map((r) => (s.races.length > 1 ? `${s.name}: ${r.name}` : s.name)));
      editor.replaceChildren(
        h('div', { class: 'lib-empty' },
          h('h2', {}, 'Library'),
          h('p', {}, counts),
          h('p', { class: 'muted' }, 'Pick something on the left to change it, or add something new. Everything saves as you type.'),
          needing.length ? h('div', {}, h('h3', {}, `Races that need stats (${needing.length})`), h('p', { class: 'small' }, needing.join(' · '))) : null,
          tab === 'species' ? fillTable() : null,
        ),
      );
      return;
    }
    editor.replaceChildren(
      h('div', { class: 'lib-editor-head' }, h('h2', {}, title || 'Unnamed'), h('div', { class: 'sketch-actions' }, h('button', { type: 'button', class: 'ghost small', onclick: duplicate }, 'Duplicate'), h('button', { type: 'button', class: 'ghost small danger', onclick: () => askDelete(title) }, 'Delete'))),
      ...body,
    );
  };
  const askDelete = (name: string) => {
    const bar = h('div', { class: 'danger-zone' }, h('span', { class: 'small' }, `Delete “${name}” from this library?`), h('button', { type: 'button', class: 'danger-solid', onclick: remove }, 'Delete'), h('button', { type: 'button', class: 'ghost', onclick: () => bar.remove() }, 'Keep'));
    editor.querySelector('.lib-editor-head')?.after(bar);
  };

  const TABS: [Tab, string][] = [['species', 'Peoples'], ['beasts', 'Beasts'], ['traits', 'Traits'], ['resources', 'Resources'], ['techs', 'Technology'], ['behaviours', 'Behaviours'], ['traditions', 'Traditions'], ['cultures', 'Cultures'], ['governments', 'Governments'], ['faiths', 'Faiths'], ['tenets', 'Tenets'], ['gods', 'Gods']];
  const renderTabs = () =>
    tabsEl.replaceChildren(
      ...TABS.map(([id, name]) => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': tab === id ? 'true' : 'false', onclick: () => { tab = id; selected = null; search = ''; renderTabs(); renderList(); renderEditor(); } }, name)),
    );

  // ---- Files and the shared library ----
  const file = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden' }) as HTMLInputElement;
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      lib = parseLibraryFile(await f.text());
      selected = null;
      saveNow();
      renderAll();
      toast(`Imported the library from “${f.name}”.`);
    } catch (err) {
      toast((err as Error).message);
    }
  });
  const exportFile = () => {
    const blob = new Blob([libraryFile(lib)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${(w?.settings.name ?? 'library').replace(/[^\w-]+/g, '_')}-library.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const confirmBar = h('div', {});
  const ask = (q: string, yes: string, act: () => void) =>
    confirmBar.replaceChildren(h('div', { class: 'danger-zone' }, h('span', { class: 'small' }, q), h('button', { type: 'button', class: 'danger-solid', onclick: () => { act(); confirmBar.replaceChildren(); } }, yes), h('button', { type: 'button', class: 'ghost', onclick: () => confirmBar.replaceChildren() }, 'Cancel')));
  const actions = h(
    'div',
    { class: 'tools' },
    h('button', { type: 'button', class: 'ghost', onclick: exportFile, title: 'Save this library as a file, to keep or share.' }, 'Export…'),
    h('button', { type: 'button', class: 'ghost', onclick: () => file.click(), title: 'Replace this library with one from a file.' }, 'Import…'),
    w
      ? h('button', { type: 'button', class: 'ghost', title: 'Replace this world’s library with the shared one.', onclick: () => ask('Replace this world’s library with the shared library? Changes made only in this world are lost.', 'Replace', () => { lib = loadSharedLibrary(app.store); selected = null; saveNow(); renderAll(); }) }, 'Load shared library')
      : null,
    w
      ? h('button', { type: 'button', class: 'ghost', title: 'Make the shared library a copy of this world’s.', onclick: () => ask('Replace the shared library (used by new worlds) with this world’s library?', 'Replace', () => { saveSharedLibrary(app.store, cloneLibrary(lib)); toast('The shared library is now a copy of this world’s.'); }) }, 'Save as shared library')
      : h('button', { type: 'button', class: 'ghost danger', title: 'Back to the starting roster and lists.', onclick: () => ask('Reset the shared library to the starting roster, traits, resources and beasts? Your changes to it are lost (worlds keep their own copies).', 'Reset', () => { lib = defaultLibrary(); selected = null; saveNow(); renderAll(); }) }, 'Reset to start'),
    file,
  );

  const renderAll = () => {
    renderTabs();
    renderList();
    renderEditor();
  };
  const back = () => {
    saveNow();
    if (w) app.open(w);
    else app.start();
  };
  app.root.append(
    h(
      'div',
      { class: 'library' },
      h('header', { class: 'topbar' }, h('div', { class: 'title' }, h('h1', {}, w ? `Library: ${w.settings.name}` : 'Library'), h('span', { class: 'muted small' }, w ? 'This world’s own copy: changes here stay in this world.' : 'The shared library: each new world starts with a copy of it.')), h('nav', { class: 'tools' }, h('button', { type: 'button', class: 'ghost', onclick: back }, w ? '← Back to the world' : '← Main menu'), status, actions)),
      confirmBar,
      h('div', { class: 'lib-body' }, h('aside', { class: 'lib-side' }, tabsEl, listEl), h('main', { class: 'lib-main' }, editor)),
    ),
  );
  renderAll();
  // An existing world gets its own copy the first time its library is opened.
  if (w && !w.library) saveNow();
  const beforeUnload = () => saveNow();
  window.addEventListener('beforeunload', beforeUnload);
  return () => {
    saveNow();
    clearTimeout(listTimer);
    window.removeEventListener('beforeunload', beforeUnload);
  };
}
