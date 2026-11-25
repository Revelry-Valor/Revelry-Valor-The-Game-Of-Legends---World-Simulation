/** Small helpers for building the interface without a framework. */

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

/** Make an element: h('button', { class: 'primary', onclick: fn }, 'Save'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** A labelled number field, optionally with a slider. Calls `change` with the new value. */
export function numberField(opts: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  hint?: string;
  slider?: boolean;
  change: (v: number) => void;
}): HTMLElement {
  const id = `f${Math.random().toString(36).slice(2, 9)}`;
  const num = h('input', { id, type: 'number', min: opts.min, max: opts.max, step: opts.step, value: opts.value, inputmode: 'decimal' });
  const range = opts.slider ? h('input', { type: 'range', min: opts.min, max: opts.max, step: opts.step, value: opts.value, 'aria-label': opts.label }) : null;
  const set = (v: number, from: HTMLInputElement) => {
    if (!Number.isFinite(v)) return;
    if (from !== num) num.value = String(v);
    if (range && from !== range) range.value = String(v);
    opts.change(v);
  };
  num.addEventListener('input', () => set(num.valueAsNumber, num));
  range?.addEventListener('input', () => set(range.valueAsNumber, range));
  return h(
    'div',
    { class: 'field' },
    h('label', { for: id }, opts.label),
    h('div', { class: 'field-row' }, range, num, opts.unit ? h('span', { class: 'unit' }, opts.unit) : null),
    opts.hint ? h('small', {}, opts.hint) : null,
  );
}

/** A row of buttons acting as one choice. */
export function choice<T extends string>(label: string, options: { value: T; label: string; disabled?: boolean; title?: string }[], value: T, change: (v: T) => void): HTMLElement {
  const group = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': o.value === value ? 'true' : 'false', disabled: o.disabled, title: o.title }, o.label);
    b.addEventListener('click', () => {
      for (const x of buttons) x.setAttribute('aria-checked', x === b ? 'true' : 'false');
      change(o.value);
    });
    return b;
  });
  group.append(...buttons);
  return h('div', { class: 'field' }, h('span', { class: 'label' }, label), group);
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

/** A short message at the bottom of the screen (pop-up alerts can be blocked where the app is hosted). */
export function toast(text: string, ms = 6000): void {
  let el = document.querySelector<HTMLElement>('.toast');
  if (!el) {
    el = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = text;
  el.hidden = false;
  clearTimeout(Number(el.dataset.timer));
  el.dataset.timer = String(window.setTimeout(() => (el!.hidden = true), ms));
}

/**
 * A help card that opens when the pointer rests on an element (or it holds keyboard focus) for a
 * while: four seconds by default, so it stays out of the way of quick clicking.
 */
export function hoverHelp(el: HTMLElement, text: () => string, delayMs = 4000): void {
  let timer = 0;
  let card: HTMLElement | null = null;
  const close = () => {
    clearTimeout(timer);
    card?.remove();
    card = null;
  };
  const open = () => {
    close();
    timer = window.setTimeout(() => {
      if (!el.isConnected) return;
      card = h('div', { class: 'hover-help', role: 'tooltip' });
      for (const [i, line] of text().split('\n').entries()) card.append(i ? h('div', {}, line) : h('strong', {}, line));
      document.body.append(card);
      const r = el.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const left = Math.max(8, Math.min(window.innerWidth - c.width - 8, r.left));
      const top = r.bottom + 6 + c.height > window.innerHeight ? r.top - c.height - 6 : r.bottom + 6;
      card.style.left = `${left}px`;
      card.style.top = `${Math.max(8, top)}px`;
    }, delayMs);
  };
  el.addEventListener('pointerenter', open);
  el.addEventListener('focus', open);
  for (const ev of ['pointerleave', 'blur', 'pointerdown', 'keydown']) el.addEventListener(ev, close);
}
