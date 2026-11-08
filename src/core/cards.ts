// Deterministic card generation: card n is reproducible from (seed, n, attempt).
import { cyrb128, seededRng, shuffle } from './rng';
import { allBalls, centerIndex, columnRange, hasFreeCell, isColumnMode } from './symbols';
import type { Card, GameConfig } from './types';

export type CardConfig = Pick<
  GameConfig,
  'size' | 'mode' | 'poolMin' | 'poolMax' | 'freeCenter' | 'cardCount' | 'startNumber'
>;

function pickDistinct(lo: number, hi: number, count: number, rng: () => number): number[] {
  const vals: number[] = [];
  for (let v = lo; v <= hi; v++) vals.push(v);
  // partial Fisher–Yates
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (vals.length - i));
    [vals[i], vals[j]] = [vals[j], vals[i]];
  }
  return vals.slice(0, count);
}

/** Generate the cells for card `no` at attempt `attempt`. Pure & deterministic. */
export function generateCardCells(cfg: CardConfig, seed: string, no: number, attempt = 0): number[] {
  const rng = seededRng(seed, 'card', no, attempt);
  const n = cfg.size;
  const free = hasFreeCell(cfg);
  const center = centerIndex(n);
  const cells = new Array<number>(n * n).fill(0);
  if (isColumnMode(cfg)) {
    for (let c = 0; c < n; c++) {
      const [lo, hi] = columnRange(cfg, c);
      const isCenterCol = free && c === Math.floor(n / 2);
      const count = isCenterCol ? n - 1 : n;
      const vals = pickDistinct(lo, hi, count, rng).sort((a, b) => a - b);
      let k = 0;
      for (let r = 0; r < n; r++) {
        const idx = r * n + c;
        if (isCenterCol && idx === center) cells[idx] = 0;
        else cells[idx] = vals[k++];
      }
    }
  } else {
    const pool = allBalls(cfg);
    shuffle(pool, rng);
    let k = 0;
    for (let i = 0; i < n * n; i++) {
      if (free && i === center) cells[i] = 0;
      else cells[i] = pool[k++];
    }
  }
  return cells;
}

export function cardKey(cells: number[]): string {
  return cells.filter((v) => v !== 0).sort((a, b) => a - b).join(',');
}

/**
 * Build the attempt map: only card numbers that collided with an earlier card
 * get an entry (cardNo -> attempt index).
 */
export function buildAttemptMap(cfg: CardConfig, seed: string): Record<number, number> {
  const seen = new Set<string>();
  const attempts: Record<number, number> = {};
  for (let i = 0; i < cfg.cardCount; i++) {
    const no = cfg.startNumber + i;
    let attempt = 0;
    for (;;) {
      const key = cardKey(generateCardCells(cfg, seed, no, attempt));
      if (!seen.has(key)) {
        seen.add(key);
        break;
      }
      attempt++;
      if (attempt > 10000) throw new Error('ไม่สามารถสร้างใบที่ไม่ซ้ำได้ — จำนวนลูกน้อยเกินไป');
    }
    if (attempt > 0) attempts[no] = attempt;
  }
  return attempts;
}

export function getCard(cfg: CardConfig, seed: string, attempts: Record<number, number>, no: number): Card {
  return { no, cells: generateCardCells(cfg, seed, no, attempts[no] ?? 0) };
}

export function getAllCards(cfg: CardConfig, seed: string, attempts: Record<number, number>): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < cfg.cardCount; i++) out.push(getCard(cfg, seed, attempts, cfg.startNumber + i));
  return out;
}

export function isValidCardNo(cfg: CardConfig, no: number): boolean {
  return Number.isInteger(no) && no >= cfg.startNumber && no < cfg.startNumber + cfg.cardCount;
}

// --- Card number + check code ---
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no O/0/I/1

export function checkCode(seed: string, no: number): string {
  const [a, b] = cyrb128(`${seed}#check#${no}`);
  let x = a ^ Math.imul(b, 0x9e3779b1);
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += CODE_ALPHABET[(x >>> (i * 5)) & 31];
  }
  return out;
}

export function formatCardNo(no: number): string {
  return '#' + String(no).padStart(4, '0');
}

/** Normalize user-typed code: uppercase, map ambiguous chars */
export function normalizeCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
