/// <reference lib="webworker" />
import { createSimulation, summarize, type RoundSim } from '../core/estimate';
import type { GameConfig } from '../core/types';

type Req = { id: number; cfg: GameConfig; games: number };

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, cfg, games } = e.data;
  try {
    const sim = createSimulation(cfg);
    const res: RoundSim[][] = [];
    for (let i = 0; i < games; i++) {
      res.push(sim.runGame(i));
      if (i % 15 === 0) (self as DedicatedWorkerGlobalScope).postMessage({ id, progress: i / games });
    }
    (self as DedicatedWorkerGlobalScope).postMessage({ id, result: summarize(res, sim.rounds) });
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({ id, error: String((err as Error).message) });
  }
};
