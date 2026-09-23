import type { Rng } from './rng';
import type { Phonemes } from './types';

const GLOBAL_ONSETS = ['b', 'c', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'sh', 'th', 'kh', 'tr', 'gl', 'y'];
const GLOBAL_VOWELS = ['a', 'e', 'i', 'o', 'u', 'ai', 'au', 'ei', 'oa', 'y'];
const GLOBAL_CODAS = ['n', 'r', 's', 'l', 'm', 'k', 't', 'th', 'sh', 'x', 'rn', 'nd'];

function subset(rng: Rng, arr: string[], min: number): string[] {
  const out = arr.filter(() => rng.chance(0.7));
  while (out.length < Math.min(min, arr.length)) {
    const p = rng.pick(arr);
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** A culture's language: a random subset of its race's sound palette, so sibling cultures sound related. */
export function deriveLanguage(rng: Rng, base: Phonemes): Phonemes {
  return {
    onsets: subset(rng, base.onsets, 5),
    vowels: subset(rng, base.vowels, 3),
    codas: subset(rng, base.codas, 3),
    settlementSuffixes: subset(rng, base.settlementSuffixes, 2),
    minSyllables: base.minSyllables,
    maxSyllables: base.maxSyllables,
  };
}

/** A daughter language drifts: some sounds are lost, some borrowed. */
export function mutateLanguage(rng: Rng, lang: Phonemes): Phonemes {
  const swap = (arr: string[], pool: string[]) => {
    const out = [...arr];
    const n = rng.int(1, 2);
    for (let i = 0; i < n; i++) {
      if (out.length > 3 && rng.chance(0.5)) out.splice(rng.int(0, out.length - 1), 1);
      out.push(rng.pick(pool));
    }
    return [...new Set(out)];
  };
  const suffixes = [...lang.settlementSuffixes];
  if (rng.chance(0.6)) suffixes.push(makeWord(rng, lang).toLowerCase().slice(0, 4));
  return {
    onsets: swap(lang.onsets, GLOBAL_ONSETS),
    vowels: swap(lang.vowels, GLOBAL_VOWELS),
    codas: swap(lang.codas, GLOBAL_CODAS),
    settlementSuffixes: suffixes,
    minSyllables: lang.minSyllables,
    maxSyllables: lang.maxSyllables,
  };
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function makeWord(rng: Rng, lang: Phonemes, minSyl?: number, maxSyl?: number): string {
  const n = rng.int(minSyl ?? lang.minSyllables, maxSyl ?? lang.maxSyllables);
  let w = '';
  for (let i = 0; i < n; i++) {
    if (i === 0 || rng.chance(0.75)) w += rng.pick(lang.onsets);
    w += rng.pick(lang.vowels);
    if (i === n - 1 ? rng.chance(0.6) : rng.chance(0.25)) w += rng.pick(lang.codas);
  }
  // Collapse awkward triple letters.
  w = w.replace(/(.)\1\1+/g, '$1$1');
  return capitalize(w);
}

const BLOCKED = ['dick', 'cock', 'fuck', 'shit', 'cunt', 'piss', 'nigg', 'fag', 'rape', 'twat', 'anus', 'slut', 'whore', 'porn', 'nazi', 'poop', 'tits', 'penis', 'vagin', 'kkk', 'sex', 'cum', 'wank', 'bitch', 'bastard', 'turd'];

export function isAcceptableName(n: string): boolean {
  const l = n.toLowerCase();
  if (l.startsWith('ass') || l.endsWith('ass')) return false;
  return !BLOCKED.some((b) => l.includes(b));
}

export class NameBook {
  private used = new Set<string>();

  unique(rng: Rng, gen: () => string): string {
    for (let i = 0; i < 30; i++) {
      const n = gen();
      if (n.length >= 3 && !this.used.has(n) && isAcceptableName(n)) {
        this.used.add(n);
        return n;
      }
    }
    const n = gen() + ' ' + ['Minor', 'Nova', 'Secunda', 'Tertia'][rng.int(0, 3)];
    this.used.add(n);
    return n;
  }

  settlement(rng: Rng, lang: Phonemes): string {
    return this.unique(rng, () => {
      const root = makeWord(rng, lang);
      if (rng.chance(0.35) && lang.settlementSuffixes.length) return root + rng.pick(lang.settlementSuffixes);
      return root;
    });
  }

  polity(rng: Rng, lang: Phonemes): string {
    return this.unique(rng, () => makeWord(rng, lang, 2, Math.max(2, lang.maxSyllables)));
  }

  person(rng: Rng, lang: Phonemes): string {
    let n = makeWord(rng, lang, 2, Math.max(2, lang.maxSyllables));
    for (let i = 0; i < 20 && !isAcceptableName(n); i++) n = makeWord(rng, lang, 2, Math.max(2, lang.maxSyllables));
    return n;
  }

  culture(rng: Rng, lang: Phonemes): { name: string; adjective: string } {
    const name = this.unique(rng, () => makeWord(rng, lang, 2, 2));
    return { name, adjective: adjectiveOf(name) };
  }
}

export function adjectiveOf(name: string): string {
  const last = name.slice(-1);
  if ('aeiouy'.includes(last)) return name + 'n';
  if (last === 's' || last === 'x') return name + 'ian';
  return name + (name.length % 2 ? 'ic' : 'ian');
}

export function randomColor(rng: Rng, sat = [45, 75], light = [42, 62]): string {
  const h = rng.int(0, 359);
  const s = rng.int(sat[0], sat[1]);
  const l = rng.int(light[0], light[1]);
  return `hsl(${h} ${s}% ${l}%)`;
}
