// The frozen card set of a game: the single source of truth for every feature
// (print, PDF, Control winner detection, card checker, Display reveal, near-miss stats).
import { useEffect, useSyncExternalStore } from 'react';
import { buildAttemptMap } from '../core/cards';
import {
  computeSetCode,
  CURRENT_GENERATOR,
  decodeCards,
  encodeCards,
  generateCards,
  mapConfigImages,
  snapshotsEqual,
  type CardSnapshot,
  type FrozenMeta,
  type GeneratorVersion,
} from '../core/frozen';
import type { GameRecord } from '../core/game';
import { newSeed } from '../core/rng';
import type { Card, GameConfig } from '../core/types';
import { dispatchTo, listGames, loadGame } from './gameStore';
import { freezeImageRef } from './images';
import { loadSnapshot, saveSnapshot } from './snapshotDb';

export type CardSet = {
  gameId: string;
  setCode: string;
  snap: CardSnapshot;
  cards: Card[];
  byNo: Map<number, Card>;
};

/** Copy every image the config uses into content-addressed storage and point the config at it */
export async function freezeConfigImages(cfg: GameConfig): Promise<GameConfig> {
  const map = new Map<string, string>();
  for (const ref of [cfg.eventLogo, ...cfg.columns.map((c) => c.image), ...cfg.items.map((c) => c.image)]) {
    if (ref && !map.has(ref)) map.set(ref, await freezeImageRef(ref));
  }
  return mapConfigImages(cfg, (r) => map.get(r) ?? r);
}

export async function buildFrozen(version: GeneratorVersion, seed: string, attempts: Record<number, number>, cfg: GameConfig) {
  const config = await freezeConfigImages(cfg);
  const snap = encodeCards(version, config.size, config.startNumber, generateCards(version, config, seed, attempts));
  const setCode = await computeSetCode(version, seed, config, snap);
  return { config, snap, setCode };
}

/** "Generate cards": new seed, frozen images, snapshot saved before the game is locked */
export async function generateNewSet(g: GameRecord, cfg: GameConfig = g.config) {
  const seed = newSeed();
  const attempts = buildAttemptMap(cfg, seed);
  const { config, snap, setCode } = await buildFrozen(CURRENT_GENERATOR, seed, attempts, cfg);
  await saveSnapshot(g.id, snap);
  const frozen: FrozenMeta = { generatorVersion: CURRENT_GENERATOR, setCode, origin: 'generated', verified: true, backupPending: false };
  return { seed, attempts, config, frozen };
}

// ---------- cache + loading ----------
const cache = new Map<string, CardSet>();
const errors = new Map<string, string>();
const inflight = new Map<string, Promise<CardSet | null>>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

function makeSet(gameId: string, setCode: string, snap: CardSnapshot): CardSet {
  const cards = decodeCards(snap);
  return { gameId, setCode, snap, cards, byNo: new Map(cards.map((c) => [c.no, c])) };
}

/** Existing game generated before card snapshots existed: freeze with the v1 generator, on this machine */
async function migrate(g: GameRecord): Promise<GameRecord> {
  const { config, snap, setCode } = await buildFrozen(1, g.seed!, g.attempts, g.config);
  await saveSnapshot(g.id, snap);
  const frozen: FrozenMeta = { generatorVersion: 1, setCode, origin: 'migrated', verified: true, backupPending: true };
  return dispatchTo(g.id, { type: 'FREEZE', config, frozen, note: `บันทึกใบถาวรจากเครื่องนี้ (ตัวสร้างรุ่น 1) ชุดใบ ${setCode}` }) ?? { ...g, config, frozen };
}

async function load(g0: GameRecord): Promise<CardSet | null> {
  let g = g0;
  if (!g.seed) return null;
  if (!g.frozen) g = await migrate(g);
  const fz = g.frozen!;
  const stored = await loadSnapshot(g.id);
  if (stored && (await computeSetCode(fz.generatorVersion, g.seed!, g.config, stored)) === fz.setCode) return makeSet(g.id, fz.setCode, stored);
  // snapshot missing or damaged (e.g. site data partly cleared): rebuild it, but only accept the
  // result if it reproduces the recorded set code exactly
  const rebuilt = encodeCards(fz.generatorVersion, g.config.size, g.config.startNumber, generateCards(fz.generatorVersion, g.config, g.seed!, g.attempts));
  if ((await computeSetCode(fz.generatorVersion, g.seed!, g.config, rebuilt)) !== fz.setCode)
    throw new Error(`ข้อมูลใบของเกมนี้เสียหาย และสร้างใหม่ให้ตรงชุดใบ ${fz.setCode} ไม่ได้ — กรุณา import ไฟล์ backup`);
  if (stored && !snapshotsEqual(stored, rebuilt)) console.warn('card snapshot was damaged and has been rebuilt');
  await saveSnapshot(g.id, rebuilt);
  return makeSet(g.id, fz.setCode, rebuilt);
}

/** Load (migrating / repairing if needed) the card set for a game. */
export function ensureCardSet(g: GameRecord): Promise<CardSet | null> {
  if (!g.seed) return Promise.resolve(null);
  const hit = cache.get(g.id);
  if (hit && g.frozen && hit.setCode === g.frozen.setCode) return Promise.resolve(hit);
  const k = g.id + '|' + (g.frozen?.setCode ?? 'unfrozen');
  let p = inflight.get(k);
  if (!p) {
    p = load(g)
      .then((s) => {
        if (s) cache.set(g.id, s);
        errors.delete(g.id);
        return s;
      })
      .catch((e) => {
        errors.set(g.id, String((e as Error).message));
        return null;
      })
      .finally(() => {
        inflight.delete(k);
        emit();
      });
    inflight.set(k, p);
  }
  return p;
}

export function getCardSet(g: GameRecord | null): CardSet | null {
  if (!g?.seed || !g.frozen) return null;
  const s = cache.get(g.id);
  return s && s.setCode === g.frozen.setCode ? s : null;
}

export function forgetCardSet(gameId: string) {
  cache.delete(gameId);
  emit();
}

export function useCardSet(g: GameRecord | null): { set: CardSet | null; error: string | null; loading: boolean } {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  const set = getCardSet(g);
  useEffect(() => {
    if (g?.seed && !set) void ensureCardSet(g);
  }, [g, set]);
  const error = g ? errors.get(g.id) ?? null : null;
  return { set, error, loading: !!g?.seed && !set && !error };
}

/** Freeze every stored game that was generated before snapshots existed (runs once at start-up) */
export async function migrateAllGames(): Promise<number> {
  let n = 0;
  for (const m of listGames()) {
    if (m.setCode) continue; // index entries written by older versions have no `generated` flag

    const g = loadGame(m.id);
    if (g?.seed && !g.frozen) {
      await ensureCardSet(g);
      n++;
    }
  }
  return n;
}
