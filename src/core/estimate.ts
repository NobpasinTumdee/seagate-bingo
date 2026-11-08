// Monte Carlo "suspense estimator": simulates whole games across all rounds.
import { buildAttemptMap, getAllCards } from './cards';
import { matchMask } from './patterns';
import { newSeed, seededRng, shuffle } from './rng';
import { allBalls } from './symbols';
import type { GameConfig } from './types';
import { Engine } from './winners';

export type RoundSim = { firstDraw: number; simultaneous: number };
export type RoundEstimate = {
  mean: number;
  p10: number;
  p90: number;
  multiChance: number; // 0..1, P(>= 2 winners at the first winning draw)
  level: 'ok' | 'warn' | 'bad';
};

export type Simulation = { runGame: (i: number) => RoundSim[]; rounds: number };

export function createSimulation(cfg: GameConfig, seed = newSeed()): Simulation {
  const attempts = buildAttemptMap(cfg, seed);
  const cards = getAllCards(cfg, seed, attempts);
  const engine = new Engine(cfg, seed, attempts, cards);
  const n = cards.length;
  // ball -> list of packed (cardIdx<<6|bit)
  const index = new Map<number, number[]>();
  cards.forEach((c, ci) => c.cells.forEach((v, bit) => {
    if (v === 0) return;
    let a = index.get(v);
    if (!a) index.set(v, (a = []));
    a.push((ci << 6) | bit);
  }));
  const base = engine.marks([]);
  const patterns = cfg.rounds.map((_, r) => engine.roundPattern(r));
  const balls = allBalls(cfg);

  const runGame = (gi: number): RoundSim[] => {
    const rng = seededRng(seed, 'sim', gi);
    const order = shuffle(balls.slice(), rng);
    const lo = base.lo.slice();
    const hi = base.hi.slice();
    const wonBefore = new Uint8Array(n); // won an earlier round
    const out: RoundSim[] = [];
    let round = 0;
    let roundWinners = 0;
    let firstDraw = 0;
    let simultaneous = 0;

    const scanAll = (draw: number): number[] => {
      const p = patterns[round];
      const w: number[] = [];
      for (let i = 0; i < n; i++) {
        if (!cfg.allowRepeatWinners && wonBefore[i]) continue;
        if (matchMask(lo[i], hi[i], p)) w.push(i);
      }
      void draw;
      return w;
    };

    const commit = (newW: number[], draw: number): boolean => {
      if (newW.length === 0) return false;
      if (roundWinners === 0) {
        firstDraw = draw;
        simultaneous = newW.length;
      }
      roundWinners += newW.length;
      for (const i of newW) wonBefore[i] = 1;
      if (roundWinners >= (cfg.rounds[round]?.winnersWanted ?? 1)) {
        out.push({ firstDraw, simultaneous });
        round++;
        roundWinners = 0;
        return true;
      }
      return false;
    };

    const roundWon = new Uint8Array(n);
    for (let d = 0; d < order.length && round < patterns.length; d++) {
      const arr = index.get(order[d]) ?? [];
      const touched: number[] = [];
      for (const packed of arr) {
        const ci = packed >> 6;
        const bit = packed & 63;
        if (bit < 32) lo[ci] |= 1 << bit;
        else hi[ci] |= 1 << (bit - 32);
        touched.push(ci);
      }
      const p = patterns[round];
      const newW: number[] = [];
      for (const ci of touched) {
        if (roundWon[ci] || (!cfg.allowRepeatWinners && wonBefore[ci])) continue;
        if (matchMask(lo[ci], hi[ci], p)) newW.push(ci);
      }
      for (const ci of newW) roundWon[ci] = 1;
      let advanced = commit(newW, d + 1);
      // When a round completes, the next round is evaluated immediately at the same draw
      while (advanced && round < patterns.length) {
        roundWon.fill(0);
        const w = scanAll(d + 1);
        for (const ci of w) roundWon[ci] = 1;
        advanced = commit(w, d + 1);
      }
    }
    while (out.length < patterns.length) out.push({ firstDraw: balls.length, simultaneous: 0 });
    return out;
  };

  return { runGame, rounds: patterns.length };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

export function summarize(results: RoundSim[][], rounds: number): RoundEstimate[] {
  const out: RoundEstimate[] = [];
  for (let r = 0; r < rounds; r++) {
    const draws = results.map((g) => g[r].firstDraw).sort((a, b) => a - b);
    const mean = draws.reduce((s, x) => s + x, 0) / Math.max(1, draws.length);
    const multi = results.filter((g) => g[r].simultaneous >= 2).length / Math.max(1, results.length);
    const level: RoundEstimate['level'] = mean < 6 || multi > 0.5 ? 'bad' : mean < 10 || multi > 0.3 ? 'warn' : 'ok';
    out.push({ mean, p10: percentile(draws, 0.1), p90: percentile(draws, 0.9), multiChance: multi, level });
  }
  return out;
}

/** Synchronous convenience wrapper (tests / workers) */
export function estimate(cfg: GameConfig, games = 300, seed?: string): RoundEstimate[] {
  const sim = createSimulation(cfg, seed);
  const res: RoundSim[][] = [];
  for (let i = 0; i < games; i++) res.push(sim.runGame(i));
  return summarize(res, sim.rounds);
}
