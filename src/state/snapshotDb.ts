// Card snapshots live in IndexedDB (2000 cards would bloat localStorage), keyed by game id.
import { del, get, set } from 'idb-keyval';
import type { CardSnapshot } from '../core/frozen';

const key = (gameId: string) => 'cards:' + gameId;

export async function saveSnapshot(gameId: string, s: CardSnapshot): Promise<void> {
  // store a plain copy (structured clone keeps the Uint16Array)
  await set(key(gameId), { generatorVersion: s.generatorVersion, size: s.size, startNumber: s.startNumber, count: s.count, cells: new Uint16Array(s.cells) });
}

export async function loadSnapshot(gameId: string): Promise<CardSnapshot | null> {
  try {
    const v = (await get(key(gameId))) as CardSnapshot | undefined;
    if (!v || !(v.cells instanceof Uint16Array)) return null;
    return v;
  } catch {
    return null;
  }
}

export async function deleteSnapshot(gameId: string): Promise<void> {
  try {
    await del(key(gameId));
  } catch {
    /* ignore */
  }
}
