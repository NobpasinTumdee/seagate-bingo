import type { GameRecord } from '../core/game';
import { Engine } from '../core/winners';
import type { CardSet } from './cardSet';

let cached: { key: string; engine: Engine } | null = null;

/** Memoized winner engine for the active game, built from the frozen card snapshot (never regenerated). */
export function getEngine(g: GameRecord | null, set: CardSet | null): Engine | null {
  if (!g || !g.seed || !set || set.gameId !== g.id) return null;
  const key = [g.id, set.setCode, JSON.stringify(g.config.rounds), g.config.allowRepeatWinners].join('|');
  if (cached?.key !== key) cached = { key, engine: new Engine(g.config, g.seed, g.attempts, set.cards) };
  return cached.engine;
}
