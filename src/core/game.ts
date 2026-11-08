// Game record + pure reducer. All state transitions go through `gameReducer`.
import { newId } from './rng';
import { DEFAULT_POOL } from './symbols';
import type { GameConfig, LogEntry, Round, Winner } from './types';

export const SCHEMA_VERSION = 2;

export type AnimSpeed = 'fast' | 'normal' | 'max';

export type GameSettings = {
  themeId: string;
  sound: boolean;
  volume: number; // 0..1
  voice: boolean;
  speed: AnimSpeed;
  printStyle: 'color' | 'ink';
};

export type GameStatus = 'setup' | 'ready' | 'playing' | 'finished';

export type GameRecord = {
  schemaVersion: number;
  id: string;
  createdAt: number;
  updatedAt: number;
  config: GameConfig;
  seed: string | null;
  attempts: Record<number, number>;
  locked: boolean;
  draws: number[];
  winners: Winner[];
  currentRound: number;
  paused: boolean;
  status: GameStatus;
  settings: GameSettings;
  log: LogEntry[];
};

export const DEFAULT_RULES = `กติกา BINGO — New Year Party 2027
1. ผู้เล่นทุกคนได้ใบบิงโกคนละ 1 ใบ ห้ามแก้ไขหรือถ่ายเอกสารใบ
2. เมื่อสัญลักษณ์ที่ออกตรงกับในใบ ให้ขีดหรือวงช่องนั้น
3. แต่ละรอบมีลายที่ต้องได้แสดงบนจอ ใครได้ครบลายให้ตะโกน "BINGO!" แล้วยกใบขึ้นทันที
4. ทีมงานจะตรวจเลขใบและรหัสตรวจในระบบ ใบที่รหัสไม่ตรงถือเป็นโมฆะ
5. หากมีผู้ชนะหลายใบในลูกเดียวกัน ให้ [ระบุวิธีตัดสิน เช่น แบ่งรางวัล / เป่ายิ้งฉุบ]
6. การตัดสินของทีมงานถือเป็นที่สิ้นสุด`;

export function defaultRounds(): Round[] {
  return [
    { id: newId('r'), name: 'รอบที่ 1', prize: 'รางวัลที่ 1', winnersWanted: 1, patternIds: ['anyLine'] },
    { id: newId('r'), name: 'รอบที่ 2', prize: 'รางวัลที่ 2', winnersWanted: 1, patternIds: ['x'] },
    { id: newId('r'), name: 'รอบที่ 3', prize: 'รางวัลใหญ่', winnersWanted: 1, patternIds: ['blackout'] },
  ];
}

export function defaultConfig(): GameConfig {
  return {
    eventName: 'New Year Party 2027',
    eventLogo: '/assets/brand/event-logo.svg',
    eventDate: '',
    size: 5,
    mode: 'number',
    symbolSetId: 'classic',
    columns: [],
    items: [],
    poolMin: 1,
    poolMax: DEFAULT_POOL[5],
    freeCenter: true,
    rounds: defaultRounds(),
    allowRepeatWinners: false,
    cardCount: 200,
    startNumber: 1,
    rules: DEFAULT_RULES,
    customPatterns: [],
  };
}

export function defaultSettings(): GameSettings {
  return { themeId: 'seagate', sound: true, volume: 0.8, voice: true, speed: 'normal', printStyle: 'color' };
}

export function newGame(now: number, config?: GameConfig): GameRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('g'),
    createdAt: now,
    updatedAt: now,
    config: config ?? defaultConfig(),
    seed: null,
    attempts: {},
    locked: false,
    draws: [],
    winners: [],
    currentRound: 0,
    paused: false,
    status: 'setup',
    settings: defaultSettings(),
    log: [],
  };
}

/** Migrate any older record shape to the current schema */
export function migrateGame(raw: unknown): GameRecord {
  const g = raw as Partial<GameRecord> & { schemaVersion?: number };
  if (!g || typeof g !== 'object' || !g.config) throw new Error('invalid game record');
  const base = newGame(g.createdAt ?? Date.now());
  const out: GameRecord = {
    ...base,
    ...g,
    config: { ...defaultConfig(), ...g.config },
    settings: { ...defaultSettings(), ...(g.settings ?? {}) },
    log: g.log ?? [],
    winners: g.winners ?? [],
    draws: g.draws ?? [],
    attempts: g.attempts ?? {},
    schemaVersion: SCHEMA_VERSION,
  } as GameRecord;
  // v1 -> v2: `columns`/`items` snapshots and customPatterns were added
  out.config.columns = out.config.columns ?? [];
  out.config.items = out.config.items ?? [];
  out.config.customPatterns = out.config.customPatterns ?? [];
  return out;
}

export type GameAction =
  | { type: 'UPDATE_CONFIG'; patch: Partial<GameConfig> }
  | { type: 'GENERATE'; seed: string; attempts: Record<number, number> }
  | { type: 'DRAW'; ball: number; winners: number[] }
  | { type: 'UNDO' }
  | { type: 'NEXT_ROUND'; winners: number[] }
  | { type: 'ADD_WINNERS'; winners: number[] }
  | { type: 'REVEAL'; round: number; cardNos: number[] }
  | { type: 'SET_PAUSED'; paused: boolean }
  | { type: 'SET_SETTINGS'; patch: Partial<GameSettings> }
  | { type: 'END_GAME' }
  | { type: 'LOG'; logType: string; detail: string };

export type Timed<A> = A & { now: number };

function log(g: GameRecord, now: number, type: string, detail: string): LogEntry[] {
  const entries = [...g.log, { t: now, type, detail }];
  return entries.length > 2000 ? entries.slice(-2000) : entries;
}

export function canDraw(g: GameRecord): { ok: boolean; reason?: string } {
  if (!g.locked || !g.seed) return { ok: false, reason: 'ยังไม่ได้สร้างใบบิงโก' };
  if (g.status === 'finished') return { ok: false, reason: 'เกมจบแล้ว' };
  if (g.paused) return { ok: false, reason: 'เกมหยุดชั่วคราวอยู่' };
  const total = g.config.poolMax - g.config.poolMin + 1;
  if (g.draws.length >= total) return { ok: false, reason: 'ลูกหมดแล้ว' };
  return { ok: true };
}

export function remainingBalls(g: GameRecord): number[] {
  const drawn = new Set(g.draws);
  const out: number[] = [];
  for (let v = g.config.poolMin; v <= g.config.poolMax; v++) if (!drawn.has(v)) out.push(v);
  return out;
}

function addWinners(g: GameRecord, cardNos: number[], now: number): Winner[] {
  const existing = new Set(g.winners.filter((w) => w.round === g.currentRound).map((w) => w.cardNo));
  const add = cardNos
    .filter((no) => !existing.has(no))
    .map((cardNo) => ({ round: g.currentRound, cardNo, atDraw: g.draws.length, revealed: false, time: now }));
  return [...g.winners, ...add];
}

export function gameReducer(g: GameRecord, a: Timed<GameAction>): GameRecord {
  const now = a.now;
  const next = (patch: Partial<GameRecord>): GameRecord => ({ ...g, ...patch, updatedAt: now });
  switch (a.type) {
    case 'UPDATE_CONFIG':
      if (g.locked) return g;
      return next({ config: { ...g.config, ...a.patch } });
    case 'GENERATE':
      if (g.locked) return g;
      return next({
        seed: a.seed,
        attempts: a.attempts,
        locked: true,
        status: 'ready',
        log: log(g, now, 'generate', `สร้างใบ ${g.config.cardCount} ใบ`),
      });
    case 'DRAW': {
      if (!canDraw(g).ok) return g;
      if (g.draws.includes(a.ball) || a.ball < g.config.poolMin || a.ball > g.config.poolMax) return g;
      const g2: GameRecord = { ...g, draws: [...g.draws, a.ball] };
      return {
        ...g2,
        status: 'playing',
        winners: addWinners(g2, a.winners, now),
        updatedAt: now,
        log: log(g, now, 'draw', `ลูกที่ ${g2.draws.length}: ${a.ball}` + (a.winners.length ? ` (ผู้ชนะ ${a.winners.join(', ')})` : '')),
      };
    }
    case 'UNDO': {
      if (g.draws.length === 0 || g.status === 'finished') return g;
      const count = g.draws.length;
      const last = g.draws[count - 1];
      const winners = g.winners.filter((w) => w.atDraw < count);
      // move back to the earliest round that is no longer complete (if we advanced past it)
      let round = g.currentRound;
      for (let r = 0; r < g.currentRound; r++) {
        const want = g.config.rounds[r]?.winnersWanted ?? 1;
        if (winners.filter((w) => w.round === r).length < want) {
          round = r;
          break;
        }
      }
      return next({
        draws: g.draws.slice(0, -1),
        winners,
        currentRound: round,
        log: log(g, now, 'undo', `ยกเลิกลูกที่ ${count}: ${last}`),
      });
    }
    case 'NEXT_ROUND': {
      if (g.currentRound >= g.config.rounds.length - 1) return g;
      const g2 = { ...g, currentRound: g.currentRound + 1 };
      return {
        ...g2,
        winners: addWinners(g2, a.winners, now),
        updatedAt: now,
        log: log(g, now, 'round', `เริ่ม ${g.config.rounds[g2.currentRound].name}`),
      };
    }
    case 'ADD_WINNERS':
      return next({ winners: addWinners(g, a.winners, now) });
    case 'REVEAL': {
      const set = new Set(a.cardNos);
      return next({
        winners: g.winners.map((w) => (w.round === a.round && set.has(w.cardNo) ? { ...w, revealed: true } : w)),
        log: log(g, now, 'reveal', `เปิดผู้ชนะ ${g.config.rounds[a.round]?.name ?? ''}: ${a.cardNos.join(', ')}`),
      });
    }
    case 'SET_PAUSED':
      return next({ paused: a.paused, log: log(g, now, 'pause', a.paused ? 'พัก' : 'เล่นต่อ') });
    case 'SET_SETTINGS':
      return next({ settings: { ...g.settings, ...a.patch } });
    case 'END_GAME':
      return next({ status: 'finished', paused: false, log: log(g, now, 'end', 'จบเกม') });
    case 'LOG':
      return next({ log: log(g, now, a.logType, a.detail) });
  }
}
