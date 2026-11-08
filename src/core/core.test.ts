import { describe, expect, it } from 'vitest';
import { createBackup, parseBackup, serializeBackup } from './backup';
import { buildAttemptMap, cardKey, checkCode, CODE_ALPHABET, generateCardCells, getAllCards, getCard } from './cards';
import { estimate } from './estimate';
import { defaultConfig, gameReducer, newGame, type GameAction, type GameRecord } from './game';
import { compilePattern, compileRound, maskFromCells, matchMask, missingCount } from './patterns';
import { secureRandomInt } from './rng';
import { columnRange, DEFAULT_POOL, hasFreeCell, thaiNumber, validatePool } from './symbols';
import type { CardSize, GameConfig } from './types';
import { checkCard, parseCardInput } from './verify';
import { Engine } from './winners';

const SIZES: CardSize[] = [3, 4, 5, 6];

function cfgFor(size: CardSize, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    ...defaultConfig(),
    size,
    poolMin: 1,
    poolMax: DEFAULT_POOL[size],
    freeCenter: size === 5,
    cardCount: 2000,
    ...extra,
  };
}

const T = (a: GameAction) => ({ ...a, now: 1000 });

describe('cards', () => {
  it('same seed -> identical card n', () => {
    const cfg = cfgFor(5);
    for (const n of [1, 7, 1999]) {
      expect(generateCardCells(cfg, 'seed-abc', n)).toEqual(generateCardCells(cfg, 'seed-abc', n));
    }
    expect(generateCardCells(cfg, 'seed-abc', 1)).not.toEqual(generateCardCells(cfg, 'seed-xyz', 1));
  });

  for (const size of SIZES) {
    it(`2000 cards ${size}x${size}: unique, in column range, no repeats`, () => {
      const cfg = cfgFor(size);
      const seed = 'test-seed-' + size;
      const attempts = buildAttemptMap(cfg, seed);
      const cards = getAllCards(cfg, seed, attempts);
      expect(cards.length).toBe(2000);
      const keys = new Set(cards.map((c) => cardKey(c.cells)));
      expect(keys.size).toBe(2000);
      for (const card of cards) {
        const nonFree = card.cells.filter((v) => v !== 0);
        expect(new Set(nonFree).size).toBe(nonFree.length);
        expect(nonFree.length).toBe(size * size - (hasFreeCell(cfg) ? 1 : 0));
        card.cells.forEach((v, i) => {
          if (v === 0) return;
          const [lo, hi] = columnRange(cfg, i % size);
          expect(v).toBeGreaterThanOrEqual(lo);
          expect(v).toBeLessThanOrEqual(hi);
        });
      }
      // reproducible from (seed, n, attempts)
      expect(getCard(cfg, seed, attempts, 1234).cells).toEqual(cards[1233].cells);
    });
  }

  it('collisions get an attempt index (tiny pool)', () => {
    const cfg: GameConfig = { ...cfgFor(3), poolMax: 9, freeCenter: false, cardCount: 20, mode: 'number' };
    // pool of 9 with 3 per column -> exactly 1 possible card; second card cannot be unique
    expect(() => buildAttemptMap(cfg, 's')).toThrow();
    const cfg2: GameConfig = { ...cfgFor(3), poolMax: 12, freeCenter: false, cardCount: 60 };
    const att = buildAttemptMap(cfg2, 's2'); // 4^3 = 64 possible cards
    expect(Object.keys(att).length).toBeGreaterThan(0);
    const keys = new Set(getAllCards(cfg2, 's2', att).map((c) => cardKey(c.cells)));
    expect(keys.size).toBe(60);
  });

  it('image mode: random placement from pool', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: 'i' + i, label: 'img' + i }));
    const cfg: GameConfig = { ...cfgFor(4), mode: 'image', items, poolMin: 1, poolMax: 40, cardCount: 500 };
    expect(validatePool(cfg)).toEqual([]);
    const cards = getAllCards(cfg, 'img', buildAttemptMap(cfg, 'img'));
    for (const c of cards) {
      expect(new Set(c.cells).size).toBe(16);
      c.cells.forEach((v) => expect(v >= 1 && v <= 40).toBe(true));
    }
    expect(validatePool({ ...cfg, items: items.slice(0, 10) }).length).toBe(1);
  });

  it('check code: valid passes, altered number fails', () => {
    const code = checkCode('S', 123);
    expect(code).toHaveLength(4);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    expect(checkCode('S', 123)).toBe(code);
    // across many numbers codes differ for most
    let same = 0;
    for (let i = 1; i < 500; i++) if (checkCode('S', i) === code && i !== 123) same++;
    expect(same).toBeLessThan(3);
  });
});

describe('patterns', () => {
  const marked = (cells: number[]) => maskFromCells(cells);

  it('rows / cols / diagonals / anyLine on 5x5', () => {
    const row = compilePattern('anyRow', 5);
    const col = compilePattern('anyCol', 5);
    const diag = compilePattern('anyDiag', 5);
    const line = compilePattern('anyLine', 5);
    const r2 = marked([10, 11, 12, 13, 14]);
    expect(matchMask(r2.lo, r2.hi, row)).toBeTruthy();
    expect(matchMask(r2.lo, r2.hi, col)).toBeNull();
    const c3 = marked([3, 8, 13, 18, 23]);
    expect(matchMask(c3.lo, c3.hi, col)).toBeTruthy();
    const d = marked([4, 8, 12, 16, 20]);
    expect(matchMask(d.lo, d.hi, diag)).toBeTruthy();
    expect(matchMask(d.lo, d.hi, line)).toBeTruthy();
    expect(line.masks.length).toBe(12);
  });

  it('two lines, corners, X, frame, plus, blackout on 6x6 (hi bits)', () => {
    const n = 6;
    const all = Array.from({ length: 36 }, (_, i) => i);
    const b = compilePattern('blackout', n);
    const full = marked(all);
    expect(matchMask(full.lo, full.hi, b)).toBeTruthy();
    const almost = marked(all.slice(0, 35));
    expect(matchMask(almost.lo, almost.hi, b)).toBeNull();
    expect(missingCount(almost.lo, almost.hi, b)).toBe(1);

    const corners = marked([0, 5, 30, 35]);
    expect(matchMask(corners.lo, corners.hi, compilePattern('fourCorners', n))).toBeTruthy();

    const two = marked([0, 1, 2, 3, 4, 5, 30, 31, 32, 33, 34, 35]);
    expect(matchMask(two.lo, two.hi, compilePattern('twoLines', n))).toBeTruthy();
    const one = marked([0, 1, 2, 3, 4, 5]);
    expect(matchMask(one.lo, one.hi, compilePattern('twoLines', n))).toBeNull();

    const xCells = [0, 7, 14, 21, 28, 35, 5, 10, 15, 20, 25, 30];
    const x = marked(xCells);
    expect(matchMask(x.lo, x.hi, compilePattern('x', n))).toBeTruthy();

    const frame = compilePattern('frame', n);
    expect(frame.masks[0].count).toBe(20);
    const plus = compilePattern('plus', 5);
    expect(plus.masks[0].count).toBe(9);
  });

  it('custom pattern + free cell counts as marked', () => {
    const cfg = cfgFor(5, { cardCount: 50, rounds: [{ id: 'r', name: 'r', prize: 'p', winnersWanted: 1, patternIds: ['c1'] }], customPatterns: [{ id: 'c1', name: 'T', size: 5, cells: [0, 1, 2, 3, 4, 7, 12] }] });
    const p = compileRound(['c1'], 5, cfg.customPatterns);
    expect(p.masks.length).toBe(1);
    const engine = new Engine(cfg, 'cust', {});
    const card = engine.cards[0];
    // draw the top row and cell 7; cell 12 is the free center
    const draws = [0, 1, 2, 3, 4, 7].map((i) => card.cells[i]);
    const res = engine.evaluate(draws, 0, []);
    expect(res.newWinners).toContain(card.no);
    const st = engine.cardStatus(card.no, draws.slice(0, 5), 0);
    expect(st.missing).toBe(1);
  });
});

function playable(cardCount = 300): GameRecord {
  const cfg = cfgFor(5, { cardCount });
  let g = newGame(0, cfg);
  g = gameReducer(g, T({ type: 'GENERATE', seed: 'play', attempts: buildAttemptMap(cfg, 'play') }));
  return g;
}

describe('game reducer', () => {
  it('locks config after generation and blocks invalid draws', () => {
    let g = playable();
    expect(g.locked).toBe(true);
    const g2 = gameReducer(g, T({ type: 'UPDATE_CONFIG', patch: { size: 3 } }));
    expect(g2.config.size).toBe(5);
    g = gameReducer(g, T({ type: 'SET_PAUSED', paused: true }));
    expect(gameReducer(g, T({ type: 'DRAW', ball: 5, winners: [] })).draws).toEqual([]);
    g = gameReducer(g, T({ type: 'SET_PAUSED', paused: false }));
    g = gameReducer(g, T({ type: 'DRAW', ball: 5, winners: [] }));
    expect(gameReducer(g, T({ type: 'DRAW', ball: 5, winners: [] })).draws).toEqual([5]);
  });

  it('undo rolls back winners (and the round)', () => {
    let g = playable();
    const engine = new Engine(g.config, g.seed!, g.attempts);
    const card = engine.cards[3];
    const row = [0, 1, 2, 3, 4].map((i) => card.cells[i]);
    for (const ball of row) {
      const preview = [...g.draws, ball];
      const res = engine.evaluate(preview, g.currentRound, g.winners);
      g = gameReducer(g, T({ type: 'DRAW', ball, winners: res.newWinners }));
    }
    expect(g.winners.map((w) => w.cardNo)).toContain(card.no);
    expect(g.winners.every((w) => w.atDraw === 5)).toBe(true);
    g = gameReducer(g, T({ type: 'NEXT_ROUND', winners: [] }));
    expect(g.currentRound).toBe(1);
    g = gameReducer(g, T({ type: 'UNDO' }));
    expect(g.draws.length).toBe(4);
    expect(g.winners).toEqual([]);
    expect(g.currentRound).toBe(0);
    expect(g.log.some((l) => l.type === 'undo')).toBe(true);
  });

  it('card checker statuses', () => {
    let g = playable();
    const engine = new Engine(g.config, g.seed!, g.attempts);
    const card = engine.cards[10];
    const col = [0, 5, 10, 15, 20].map((i) => card.cells[i]);
    for (const ball of col.slice(0, 3)) g = gameReducer(g, T({ type: 'DRAW', ball, winners: [] }));
    const code = checkCode(g.seed!, card.no);
    expect(checkCard(g, engine, card.no, code).status).toBe('pending');
    expect(checkCard(g, engine, card.no, code).missing).toBeLessThanOrEqual(2);
    const wrong = code === 'AAAA' ? 'BBBB' : 'AAAA';
    expect(checkCard(g, engine, card.no, wrong).status).toBe('forged');
    // altered card number with the original code -> mismatch
    expect(checkCard(g, engine, card.no + 1, code).status).toBe('forged');
    for (const ball of col.slice(3)) g = gameReducer(g, T({ type: 'DRAW', ball, winners: [] }));
    expect(checkCard(g, engine, card.no, code).status).toBe('win');
    expect(checkCard(g, engine, 99999, '').status).toBe('notFound');
    expect(parseCardInput('#0123 ab2c')).toEqual({ no: 123, code: 'AB2C' });
  });
});

describe('performance', () => {
  it('evaluates 2000 cards x all patterns in < 50ms', () => {
    const cfg = cfgFor(6, { rounds: [{ id: 'r', name: 'r', prize: 'p', winnersWanted: 1, patternIds: ['anyLine', 'twoLines', 'fourCorners', 'x', 'frame', 'plus', 'blackout'] }] });
    const engine = new Engine(cfg, 'perf', buildAttemptMap(cfg, 'perf'));
    const draws = Array.from({ length: 40 }, (_, i) => i * 2 + 1);
    engine.evaluate(draws, 0, []); // warm up
    const t0 = performance.now();
    engine.evaluate(draws, 0, []);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe('estimator (reference values ±2)', () => {
  const refs: [CardSize, number][] = [[3, 4], [4, 7], [5, 11], [6, 21]];
  for (const [size, expected] of refs) {
    it(`${size}x${size} any line, 1000 cards ≈ draw ${expected}`, () => {
      const cfg = cfgFor(size, {
        cardCount: 1000,
        rounds: [{ id: 'r', name: 'r', prize: 'p', winnersWanted: 1, patternIds: ['anyLine'] }],
      });
      const [r] = estimate(cfg, 150, 'est-' + size);
      expect(Math.abs(r.mean - expected)).toBeLessThanOrEqual(2);
    });
  }
});

describe('backup', () => {
  it('export -> import -> identical state', () => {
    let g = playable(100);
    g = gameReducer(g, T({ type: 'DRAW', ball: 7, winners: [] }));
    g = gameReducer(g, T({ type: 'DRAW', ball: 33, winners: [] }));
    const b = createBackup(g, { abc: 'data:image/png;base64,AAAA' }, 5);
    const back = parseBackup(serializeBackup(b));
    expect(back.game).toEqual(g);
    expect(back.images).toEqual(b.images);
    const a1 = getAllCards(g.config, g.seed!, g.attempts);
    const a2 = getAllCards(back.game.config, back.game.seed!, back.game.attempts);
    expect(a2).toEqual(a1);
    expect(() => parseBackup('{"x":1}')).toThrow();
  });
});

describe('misc', () => {
  it('thai numbers', () => {
    expect(thaiNumber(23)).toBe('ยี่สิบสาม');
    expect(thaiNumber(11)).toBe('สิบเอ็ด');
    expect(thaiNumber(1)).toBe('หนึ่ง');
    expect(thaiNumber(75)).toBe('เจ็ดสิบห้า');
    expect(thaiNumber(10)).toBe('สิบ');
  });
  it('secure random int in range', () => {
    for (let i = 0; i < 1000; i++) {
      const x = secureRandomInt(7);
      expect(x >= 0 && x < 7).toBe(true);
    }
  });
});
