// Fast winner evaluation using per-card bitmasks.
import { getAllCards } from './cards';
import { compileRound, matchMask, missingCount, type CompiledPattern, type Mask } from './patterns';
import type { Card, GameConfig, Winner } from './types';

export type EvalResult = {
  /** card numbers that newly complete the current round */
  newWinners: number[];
  oneAway: number;
  twoAway: number;
};

export class Engine {
  readonly cards: Card[];
  private readonly byNo = new Map<number, number>();
  /** ball value -> packed list of (cardIdx << 6 | bit) */
  private readonly index = new Map<number, number[]>();
  private readonly freeLo: number;
  private readonly freeHi: number;
  private readonly roundCache = new Map<number, CompiledPattern>();

  constructor(readonly cfg: GameConfig, readonly seed: string, readonly attempts: Record<number, number>, cards?: Card[]) {
    this.cards = cards ?? getAllCards(cfg, seed, attempts);
    let flo = 0,
      fhi = 0;
    this.cards.forEach((card, ci) => {
      this.byNo.set(card.no, ci);
      card.cells.forEach((v, bit) => {
        if (v === 0) {
          if (ci === 0) {
            if (bit < 32) flo |= 1 << bit;
            else fhi |= 1 << (bit - 32);
          }
          return;
        }
        let arr = this.index.get(v);
        if (!arr) this.index.set(v, (arr = []));
        arr.push((ci << 6) | bit);
      });
    });
    this.freeLo = flo >>> 0;
    this.freeHi = fhi >>> 0;
  }

  cardByNo(no: number): Card | undefined {
    const i = this.byNo.get(no);
    return i === undefined ? undefined : this.cards[i];
  }

  roundPattern(r: number): CompiledPattern {
    let p = this.roundCache.get(r);
    if (!p) {
      const round = this.cfg.rounds[r];
      p = compileRound(round ? round.patternIds : [], this.cfg.size, this.cfg.customPatterns);
      this.roundCache.set(r, p);
    }
    return p;
  }

  /** Compute marked bitmasks of every card for a list of drawn balls */
  marks(draws: number[]): { lo: Uint32Array; hi: Uint32Array } {
    const n = this.cards.length;
    const lo = new Uint32Array(n).fill(this.freeLo);
    const hi = new Uint32Array(n).fill(this.freeHi);
    for (const v of draws) {
      const arr = this.index.get(v);
      if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const ci = arr[k] >> 6;
        const bit = arr[k] & 63;
        if (bit < 32) lo[ci] |= 1 << bit;
        else hi[ci] |= 1 << (bit - 32);
      }
    }
    return { lo, hi };
  }

  cardMarks(card: Card, draws: number[]): { lo: number; hi: number } {
    const drawn = new Set(draws);
    let lo = 0,
      hi = 0;
    card.cells.forEach((v, bit) => {
      if (v === 0 || drawn.has(v)) {
        if (bit < 32) lo |= 1 << bit;
        else hi |= 1 << (bit - 32);
      }
    });
    return { lo: lo >>> 0, hi: hi >>> 0 };
  }

  /** Card numbers excluded from winning round r (already won this round, or earlier rounds when repeats are off) */
  excluded(round: number, winners: Winner[]): Set<number> {
    const s = new Set<number>();
    for (const w of winners) if (w.round === round || !this.cfg.allowRepeatWinners) s.add(w.cardNo);
    return s;
  }

  isRoundComplete(round: number, winners: Winner[]): boolean {
    const want = this.cfg.rounds[round]?.winnersWanted ?? 1;
    return winners.filter((w) => w.round === round).length >= want;
  }

  evaluate(draws: number[], round: number, winners: Winner[]): EvalResult {
    const res: EvalResult = { newWinners: [], oneAway: 0, twoAway: 0 };
    if (round < 0 || round >= this.cfg.rounds.length) return res;
    const pattern = this.roundPattern(round);
    if (pattern.masks.length === 0) return res;
    const { lo, hi } = this.marks(draws);
    const excl = this.excluded(round, winners);
    const complete = this.isRoundComplete(round, winners);
    for (let i = 0; i < this.cards.length; i++) {
      const no = this.cards[i].no;
      if (excl.has(no)) continue;
      const miss = missingCount(lo[i], hi[i], pattern);
      if (miss === 0) {
        if (!complete) res.newWinners.push(no);
      } else if (miss === 1) res.oneAway++;
      else if (miss === 2) res.twoAway++;
    }
    return res;
  }

  /** Detailed status of one card for the card checker */
  cardStatus(no: number, draws: number[], round: number): { missing: number; mask: Mask | null; card?: Card } {
    const card = this.cardByNo(no);
    if (!card) return { missing: Infinity, mask: null };
    const pattern = this.roundPattern(round);
    const { lo, hi } = this.cardMarks(card, draws);
    return { missing: missingCount(lo, hi, pattern), mask: matchMask(lo, hi, pattern), card };
  }
}
