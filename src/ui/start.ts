import { deleteWorld, importWorld, listWorlds, loadWorld } from '../core/storage';
import { formatDistance } from '../core/units';
import type { App } from './main';
import { h } from './dom';

/** The start screen: Create world, or Continue a saved one. */
export function showStart(app: App): void {
  const list = h('div', { class: 'saves' });
  const render = () => {
    const worlds = listWorlds(app.store);
    list.replaceChildren(
      worlds.length
        ? h(
            'ul',
            { class: 'save-list' },
            ...worlds.map((w) => {
              const size = w.mapType === 'flat' ? `${formatDistance(w.widthKm)} × ${formatDistance(w.heightKm)}` : `Globe, radius ${formatDistance(w.radiusKm)}`;
              const open = () => {
                const world = loadWorld(app.store, w.id);
                if (world) app.open(world);
                else alert('This world could not be opened. It may be damaged.');
              };
              return h(
                'li',
                {},
                h('button', { type: 'button', class: 'save-open', onclick: open }, h('strong', {}, w.name), h('span', { class: 'muted' }, `${size} · saved ${new Date(w.updatedAt).toLocaleString()}`)),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'ghost danger',
                    'aria-label': `Delete ${w.name}`,
                    onclick: () => {
                      if (confirm(`Delete "${w.name}"? This can't be undone.`)) {
                        deleteWorld(app.store, w.id);
                        render();
                      }
                    },
                  },
                  'Delete',
                ),
              );
            }),
          )
        : h('p', { class: 'muted' }, 'No saved worlds yet. Create one to begin.'),
    );
  };
  render();

  const file = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: 'import-file' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      importWorld(app.store, await f.text());
      render();
    } catch (err) {
      alert((err as Error).message);
    }
    file.value = '';
  });

  app.root.append(
    h(
      'main',
      { class: 'start' },
      h('header', { class: 'start-head' }, h('p', { class: 'kicker' }, 'Revelry & Valor'), h('h1', {}, 'The Game of Legends'), h('p', { class: 'muted' }, 'Build a world, then watch its peoples and nations live.')),
      h(
        'div',
        { class: 'start-choices' },
        h('section', { class: 'card' }, h('h2', {}, 'Create world'), h('p', { class: 'muted' }, 'Start a new world: choose its size, its place on the globe, and its planet.'), h('button', { type: 'button', class: 'primary', onclick: () => app.create() }, 'Create world')),
        h('section', { class: 'card' }, h('h2', {}, 'Continue sim'), list, h('label', { class: 'button ghost', for: 'import-file' }, 'Import a world file…'), file),
      ),
    ),
  );
}

