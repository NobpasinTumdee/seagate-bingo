// Game store: pure reducer (core/game) + localStorage persistence + React hook.
import { useSyncExternalStore } from 'react';
import { gameReducer, migrateGame, newGame, type GameAction, type GameRecord } from '../core/game';
import { newId } from '../core/rng';
import { readJSON, removeKey, writeJSON } from './storage';

const INDEX_KEY = 'bingo:index';
const ACTIVE_KEY = 'bingo:active';
const gameKey = (id: string) => `bingo:game:${id}`;

export type GameMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  size: number;
  cardCount: number;
  status: GameRecord['status'];
};

function metaOf(g: GameRecord): GameMeta {
  return {
    id: g.id,
    name: g.config.eventName,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    size: g.config.size,
    cardCount: g.config.cardCount,
    status: g.status,
  };
}

let current: GameRecord | null = null;
let indexCache: GameMeta[] | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function listGames(): GameMeta[] {
  if (!indexCache) indexCache = readJSON<GameMeta[]>(INDEX_KEY) ?? [];
  return indexCache;
}

function saveIndex(list: GameMeta[]) {
  indexCache = list;
  writeJSON(INDEX_KEY, list);
}

function persist(g: GameRecord) {
  writeJSON(gameKey(g.id), g);
  const list = listGames().filter((m) => m.id !== g.id);
  saveIndex([metaOf(g), ...list].sort((a, b) => b.updatedAt - a.updatedAt));
}

export function loadGame(id: string): GameRecord | null {
  const raw = readJSON<unknown>(gameKey(id));
  if (!raw) return null;
  try {
    return migrateGame(raw);
  } catch {
    return null;
  }
}

export function getActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveGame(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
  current = id ? loadGame(id) : null;
  emit();
}

function ensureLoaded() {
  if (current) return;
  const id = getActiveId();
  if (id) current = loadGame(id);
}

export function getGame(): GameRecord | null {
  ensureLoaded();
  return current;
}

export function createGame(): GameRecord {
  const g = newGame(Date.now());
  persist(g);
  setActiveGame(g.id);
  return g;
}

export function duplicateGame(id: string): GameRecord | null {
  const src = loadGame(id);
  if (!src) return null;
  const g = newGame(Date.now(), {
    ...structuredClone(src.config),
    rounds: src.config.rounds.map((r) => ({ ...r, id: newId('r') })),
  });
  g.settings = { ...src.settings };
  persist(g);
  setActiveGame(g.id);
  return g;
}

export function importGame(record: GameRecord, keepId = false): GameRecord {
  const g = migrateGame(structuredClone(record));
  if (!keepId || loadGame(g.id)) g.id = newId('g');
  persist(g);
  setActiveGame(g.id);
  return g;
}

export function deleteGame(id: string) {
  removeKey(gameKey(id));
  saveIndex(listGames().filter((m) => m.id !== id));
  if (getActiveId() === id) setActiveGame(null);
  else emit();
}

export function dispatch(action: GameAction): GameRecord | null {
  const g = getGame();
  if (!g) return null;
  const next = gameReducer(g, { ...action, now: Date.now() });
  if (next !== g) {
    current = next;
    persist(next);
    emit();
  }
  return next;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// keep in sync if another tab (e.g. Library / Setup) edits the active game
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    if (e.key === INDEX_KEY) {
      indexCache = null;
      emit();
    }
    const id = getActiveId();
    if (e.key === ACTIVE_KEY || (id && e.key === gameKey(id))) {
      current = id ? loadGame(id) : null;
      emit();
    }
  });
}

let version = 0;
subscribe(() => version++);

export function useGame(): GameRecord | null {
  return useSyncExternalStore(subscribe, getGame, getGame);
}

export function useGameList(): GameMeta[] {
  useSyncExternalStore(subscribe, () => version, () => version);
  return listGames();
}
