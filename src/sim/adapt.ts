import { ALT, COLD, DRY, HEAT, levelNeeded, WET, type Wants } from './attraction';
import type { Env } from './env';
import type { LiveCulture, SimState } from './state';

/**
 * Adapting to hard country (REDESIGN.md, "Where peoples live", step 3).
 *
 * A people living past what its race can bear (too hot, cold, wet, dry or high for it) has a hard
 * time there: fewer births, more deaths (attraction.ts). But a culture whose people keep living
 * there adapts over the generations: each year, where at least a quarter of its people live past
 * a tolerance, the culture gains toward bearing it, about a level in fifty years, three times as
 * fast for an adaptable race (humans). It can gain up to two levels on its race. Where none of its
 * people live in such country any more, what it gained fades very slowly.
 *
 * The gain belongs to the culture (the people living there), not to the race: their kin
 * elsewhere bear no more than before.
 */

export type TolKey = 'heat' | 'cold' | 'wet' | 'dry' | 'altitude';
export const TOL_KEYS: TolKey[] = ['heat', 'cold', 'wet', 'dry', 'altitude'];
/** Levels a year: usual, and for an adaptable race; at most this many levels in all; fading. */
export const ADAPT_RATE = 0.02;
export const ADAPT_RATE_FAST = 0.06;
export const ADAPT_MAX = 2;
const FADE = 0.005;
/** Share of a culture's people that must live past a tolerance for it to adapt. */
const SHARE = 0.25;

/** What hard country is called, for the chronicle. */
const WORDS: Record<TolKey, string> = { heat: 'the heat', cold: 'the cold', wet: 'the endless rain', dry: 'dry country', altitude: 'the heights' };

/** The tolerance level a point calls for, by kind (1 when it is easy). */
export function levelsNeeded(env: Env, k: number): Record<TolKey, number> {
  const hot = Math.max(env.temp[0][k], env.temp[1][k]);
  const cold = Math.min(env.temp[0][k], env.temp[1][k]);
  const wetSeason = Math.max(env.rain?.[0][k] ?? 0.2, env.rain?.[1][k] ?? 0.2);
  const drySeason = Math.min(env.rain?.[0][k] ?? 0.2, env.rain?.[1][k] ?? 0.2);
  return {
    heat: levelNeeded(HEAT, hot, true),
    cold: levelNeeded(COLD, cold, false),
    dry: levelNeeded(DRY, wetSeason, false),
    wet: levelNeeded(WET, drySeason, true),
    altitude: levelNeeded(ALT, env.height?.[k] ?? 0, true),
  };
}

export interface AdaptContext {
  sim: SimState;
  env: Env;
  /** Where each group of a culture's people lives (a climate point), how many, and what their race asks (with what the culture has gained so far) and whether it adapts quickly. */
  people(culture: LiveCulture): { k: number; pop: number; wants: Wants; adaptable: boolean }[];
  log(text: string, x?: number, y?: number): void;
}

/** Once a year: each culture adapts toward the hard country its people live in, or slowly loses what it no longer needs. */
export function adaptYear(c: AdaptContext): void {
  for (const cu of c.sim.cultures ?? []) {
    const groups = c.people(cu).filter((g) => g.k >= 0 && c.env.land[g.k] && g.pop > 0);
    if (!groups.length) continue;
    const total = groups.reduce((n, g) => n + g.pop, 0);
    const fast = groups.filter((g) => g.adaptable).reduce((n, g) => n + g.pop, 0) > total / 2;
    const a = (cu.adapt ??= { heat: 0, cold: 0, wet: 0, dry: 0, altitude: 0 });
    for (const key of TOL_KEYS) {
      // How many of its people live past this tolerance, and by how much (levels).
      let past = 0;
      let by = 0;
      for (const g of groups) {
        const need = levelsNeeded(c.env, g.k)[key];
        const over = need - g.wants.tolerances[key];
        if (over > 0.05) {
          past += g.pop;
          by += over * g.pop;
        }
      }
      const before = a[key];
      if (past / total >= SHARE) a[key] = Math.min(ADAPT_MAX, a[key] + Math.min(fast ? ADAPT_RATE_FAST : ADAPT_RATE, by / past));
      else if (!past) a[key] = Math.max(0, a[key] - FADE);
      if (Math.floor(a[key] * 2) > Math.floor(before * 2)) {
        const at = groups.sort((p, q) => q.pop - p.pop)[0];
        const x = c.env.x0 + (at.k % c.env.w) * c.env.step;
        const y = c.env.y0 + Math.floor(at.k / c.env.w) * c.env.step;
        c.log(`Over the generations the ${cu.name} people have grown used to ${WORDS[key]}.`, x, y);
      }
    }
  }
}
