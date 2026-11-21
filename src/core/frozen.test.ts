import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64ToBytes, bytesToBase64, sha256, sha256Sync, toHex } from './bytes';
import { buildAttemptMap, checkCode } from './cards';
import {
  cardCode,
  cellsFromBase64,
  cellsToBase64,
  computeSetCode,
  decodeCards,
  encodeCards,
  generateCards,
  type GeneratorVersion,
} from './frozen';
import { defaultConfig } from './game';
import type { GameConfig } from './types';

const SEED = 'golden-seed-2027';
const cfgOf = (p: Partial<GameConfig>): GameConfig => ({ ...defaultConfig(), eventName: 'Golden', eventLogo: '', eventDate: '', rounds: [], ...p });
const CFGS: Record<string, GameConfig> = {
  num5: cfgOf({ size: 5, mode: 'number', poolMin: 1, poolMax: 75, freeCenter: true, cardCount: 40, startNumber: 1 }),
  img4: cfgOf({
    size: 4, mode: 'image', poolMin: 1, poolMax: 20, freeCenter: false, cardCount: 30, startNumber: 101,
    items: Array.from({ length: 20 }, (_, i) => ({ id: 'i' + i, label: 'รูป ' + i, image: 'idb:sha_' + String(i).padStart(64, '0') })),
  }),
  col3: cfgOf({
    size: 3, mode: 'columnLogo', poolMin: 1, poolMax: 12, freeCenter: true, cardCount: 60, startNumber: 1,
    columns: [{ id: 'b', label: 'B', image: 'missing:/assets/b.png' }, { id: 'a', label: 'A' }, { id: 'c', label: 'C' }],
  }),
};

// Captured from the original generator BEFORE the snapshot change (see README "Generator versions").
// If any of these change, already-printed cards would no longer match: do not update them.
const GOLDEN_V1: Record<string, { attempts: Record<string, number>; first5: string[] }> = {
  num5: { attempts: {}, first5: ['1,18,32,46,61,4,19,33,51,62,10,22,0,56,64,11,29,35,57,71,14,30,41,59,75 E33X', '1,18,31,50,62,5,22,34,52,63,10,23,0,55,67,14,26,35,58,74,15,30,37,60,75 ZQDZ', '1,17,32,50,62,9,19,35,54,63,12,21,0,56,64,13,25,37,57,71,15,27,42,60,75 RDB5', '5,17,31,48,63,6,18,36,51,64,10,23,0,55,66,13,24,38,57,71,15,26,45,60,72 DQD7', '1,19,34,48,62,2,21,37,49,64,4,22,0,51,65,11,25,40,52,70,13,28,43,55,75 528Q'] },
  img4: { attempts: {}, first5: ['16,11,20,10,8,1,2,19,6,15,12,18,9,7,4,14 WF3Q', '14,16,15,8,10,18,20,4,2,5,1,17,19,9,6,11 3WVT', '15,12,17,3,5,20,10,13,18,6,19,11,1,8,16,4 KUVY', '7,1,6,2,16,3,19,11,13,5,4,12,8,14,18,9 FLMC', '5,19,16,8,7,14,1,15,11,20,6,3,13,17,18,2 XMPD'] },
  col3: { attempts: { 5: 2, 12: 1, 14: 1, 19: 1, 22: 1, 25: 2, 26: 2, 39: 2, 40: 1, 41: 1, 43: 1, 44: 2, 46: 1, 48: 1, 51: 2, 53: 1, 55: 1, 58: 1, 59: 4, 60: 1 }, first5: ['2,7,10,3,0,11,4,8,12 E33X', '1,6,10,3,0,11,4,8,12 ZQDZ', '1,7,9,3,0,10,4,8,11 RDB5', '2,7,9,3,0,10,4,8,11 DQD7', '1,5,9,2,0,11,3,7,12 528Q'] },
};
const GOLDEN_SET_CODES: Record<GeneratorVersion, Record<string, string>> = {
  1: { num5: 'TL93-MAY9', img4: '27UM-BN8T', col3: 'SS9V-ZFZ6' },
  2: { num5: 'NGNG-R3JX', img4: 'FBBM-WDGQ', col3: 'K2QA-6AZS' },
};
const GOLDEN_V2_CODES: Record<string, string[]> = {
  num5: ['W5X3', 'WH6X', 'A9PD', '9MKF', '5T77'],
  img4: ['FPV4', 'RCP8', '3RVP', 'YSMH', '9X8S'],
  col3: ['8TLA', 'CP68', 'STFZ', 'ELNG', '88E2'],
};

async function build(version: GeneratorVersion, cfg: GameConfig) {
  const attempts = buildAttemptMap(cfg, SEED);
  const cards = generateCards(version, cfg, SEED, attempts);
  const snap = encodeCards(version, cfg.size, cfg.startNumber, cards);
  const setCode = await computeSetCode(version, SEED, cfg, snap);
  return { attempts, cards, snap, setCode };
}

describe('golden output (any change here breaks printed cards)', () => {
  for (const [name, cfg] of Object.entries(CFGS)) {
    it(`generator v1: ${name}`, async () => {
      const { attempts, cards, setCode } = await build(1, cfg);
      expect(attempts).toEqual(GOLDEN_V1[name].attempts);
      expect(cards.slice(0, 5).map((c) => c.cells.join(',') + ' ' + checkCode(SEED, c.no))).toEqual(GOLDEN_V1[name].first5);
      expect(setCode).toBe(GOLDEN_SET_CODES[1][name]);
    });
    it(`generator v2: ${name}`, async () => {
      const { cards, setCode } = await build(2, cfg);
      // v2 keeps the v1 cell algorithm; only the check code formula differs
      expect(cards.slice(0, 5).map((c) => c.cells.join(','))).toEqual(GOLDEN_V1[name].first5.map((s) => s.split(' ')[0]));
      expect(setCode).toBe(GOLDEN_SET_CODES[2][name]);
      const g = { seed: SEED, frozen: { generatorVersion: 2 as const, setCode, origin: 'generated' as const, verified: true, backupPending: false } };
      expect(cards.slice(0, 5).map((c) => cardCode(g, c)), 'v2 codes ' + name).toEqual(GOLDEN_V2_CODES[name]);
    });
  }
});

describe('determinism', () => {
  afterEach(() => vi.restoreAllMocks());
  it('generation never touches Math.random, Date.now, performance.now, randomUUID or locale APIs', async () => {
    const boom = () => {
      throw new Error('non-deterministic API used');
    };
    vi.spyOn(Math, 'random').mockImplementation(boom);
    vi.spyOn(Date, 'now').mockImplementation(boom);
    vi.spyOn(performance, 'now').mockImplementation(boom);
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(boom);
    vi.spyOn(String.prototype, 'localeCompare').mockImplementation(boom);
    vi.spyOn(Intl, 'Collator').mockImplementation(boom as never);
    for (const cfg of Object.values(CFGS)) {
      for (const v of [1, 2] as const) {
        const { cards, setCode } = await build(v, cfg);
        cards.forEach((c) => cardCode({ seed: SEED, frozen: { generatorVersion: v, setCode, origin: 'generated', verified: true, backupPending: false } }, c));
      }
    }
  });

  it('snapshot encoding round-trips through base64 (little-endian, free = 0xFFFF)', async () => {
    const { snap, cards } = await build(2, CFGS.num5);
    const back = cellsFromBase64(cellsToBase64(snap.cells));
    expect(Array.from(back)).toEqual(Array.from(snap.cells));
    expect(decodeCards({ ...snap, cells: back })).toEqual(cards);
    expect(snap.cells[12]).toBe(0xffff); // free centre of card #1
  });

  it('a single changed cell changes the set code', async () => {
    const { snap, setCode } = await build(2, CFGS.num5);
    const cells = new Uint16Array(snap.cells);
    cells[100] = cells[100] === 1 ? 2 : 1;
    expect(await computeSetCode(2, SEED, CFGS.num5, { ...snap, cells })).not.toBe(setCode);
    expect(await computeSetCode(2, SEED, { ...CFGS.num5, eventName: 'Golden!' }, snap)).not.toBe(setCode);
    const col = { ...CFGS.col3, columns: [CFGS.col3.columns[1], CFGS.col3.columns[0], CFGS.col3.columns[2]] };
    const c3 = await build(2, CFGS.col3);
    expect(await computeSetCode(2, SEED, col, c3.snap)).not.toBe(c3.setCode); // column order is part of the set
  });
});

describe('bytes', () => {
  it('pure SHA-256 matches WebCrypto', async () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 70000]) {
      const d = new Uint8Array(n).map((_, i) => (i * 31 + n) & 255);
      expect(toHex(sha256Sync(d))).toBe(toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', d))));
    }
    expect(toHex(await sha256(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('base64 round trip', () => {
    for (const n of [0, 1, 2, 3, 4, 100]) {
      const d = new Uint8Array(n).map((_, i) => (i * 7 + 3) & 255);
      expect(Array.from(base64ToBytes(bytesToBase64(d)))).toEqual(Array.from(d));
      expect(bytesToBase64(d)).toBe(Buffer.from(d).toString('base64'));
    }
  });
});
