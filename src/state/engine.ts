import type { GameRecord } from '../core/game';
import { Engine } from '../core/winners';

let cached: { key: string; engine: Engine } | null = null;

/** Memoized card engine for the active game (cards are rebuilt from the seed, never stored). */
export function getEngine(g: GameRecord | null): Engine | null {
  if (!g || !g.seed) return null;
  const key = [g.id, g.seed, g.config.cardCount, g.config.startNumber, JSON.stringify(g.attempts), JSON.stringify(g.config.rounds), g.config.allowRepeatWinners].join('|');
  if (cached?.key !== key) cached = { key, engine: new Engine(g.config, g.seed, g.attempts) };
  return cached.engine;
}
