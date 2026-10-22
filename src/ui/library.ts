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

  type Tab = 'species' | 'beasts' | 'traits' | 'resources';
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
    const label = { species: 'species', beasts: 'beast', traits: 'trait', resources: 'resource' }[tab];
    listEl.replaceChildren(h('div', { class: 'lib-list-head' }, searchBox, h('button', { type: 'button', class: 'primary small', onclick: addNew }, `+ New ${label}`)), items.length ? ul : h('p', { class: 'muted small' }, 'Nothing here.'));
  };
  const addNew = () => {
    const name = { species: 'New species', beasts: 'New beast', traits: 'New trait', resources: 'New resource' }[tab];
    if (tab === 'species') {
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
    }
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
      } else {
        const r = lib.resources.find((s) => s.id === selected);
        if (r) [title, body] = [r.name, resourceEditor(r)];
      }
    }
    if (!body.length) {
      const counts = `${lib.species.length} species (${lib.species.reduce((n, s) => n + s.races.length, 0)} races), ${lib.beasts.length} beasts, ${lib.traits.length} traits, ${lib.resources.length} resources.`;
      const needing = lib.species.flatMap((s) => s.races.filter((r) => raceMissing(r).length).map((r) => (s.races.length > 1 ? `${s.name}: ${r.name}` : s.name)));
      editor.replaceChildren(
        h('div', { class: 'lib-empty' },
          h('h2', {}, 'Library'),
          h('p', {}, counts),
          h('p', { class: 'muted' }, 'Pick something on the left to change it, or add something new. Everything saves as you type.'),
          needing.length ? h('div', {}, h('h3', {}, `Races that need stats (${needing.length})`), h('p', { class: 'small' }, needing.join(' · '))) : null,
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

  const TABS: [Tab, string][] = [['species', 'Peoples'], ['beasts', 'Beasts'], ['traits', 'Traits'], ['resources', 'Resources']];
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
