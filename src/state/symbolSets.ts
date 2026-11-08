// Symbol sets: bundled (public/assets/symbols/<id>/manifest.json) + user sets (localStorage + IndexedDB images)
import { useEffect, useSyncExternalStore } from 'react';
import type { SymbolItem, SymbolSet } from '../core/types';
import { readJSON, writeJSON } from './storage';

const USER_KEY = 'bingo:symbolSets';
/** Bundled set ids. Add a folder in public/assets/symbols/<id>/ and list it here or in index.json. */
const BUNDLED_FALLBACK = ['seagate'];

export const CLASSIC_SET: SymbolSet = { id: 'classic', name: 'ตัวเลขคลาสสิก (B-I-N-G-O)', mode: 'number', builtIn: true };

let bundled: SymbolSet[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

function resolvePath(base: string, p?: string): string | undefined {
  if (!p) return undefined;
  if (/^(https?:|data:|idb:|\/)/.test(p)) return p;
  return base + p;
}

async function loadManifest(id: string): Promise<SymbolSet | null> {
  const base = `/assets/symbols/${id}/`;
  try {
    const r = await fetch(base + 'manifest.json');
    if (!r.ok) return null;
    const m = (await r.json()) as Omit<SymbolSet, 'id'> & { id?: string };
    const fix = (it: SymbolItem) => ({ ...it, image: resolvePath(base, it.image) });
    return { ...m, id: m.id ?? id, builtIn: true, columns: m.columns?.map(fix), items: m.items?.map(fix) };
  } catch {
    return null;
  }
}

export function loadBundledSets(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loading)
    loading = (async () => {
      let ids = BUNDLED_FALLBACK;
      try {
        const r = await fetch('/assets/symbols/index.json');
        if (r.ok) ids = ((await r.json()) as string[]) ?? ids;
      } catch {
        /* ignore */
      }
      const sets = await Promise.all(ids.map(loadManifest));
      bundled = sets.filter((s): s is SymbolSet => !!s);
      loaded = true;
      emit();
    })();
  return loading;
}

export function userSets(): SymbolSet[] {
  return readJSON<SymbolSet[]>(USER_KEY) ?? [];
}

export function saveUserSet(set: SymbolSet) {
  const list = userSets().filter((s) => s.id !== set.id);
  writeJSON(USER_KEY, [...list, { ...set, builtIn: false }]);
  emit();
}

export function deleteUserSet(id: string) {
  writeJSON(USER_KEY, userSets().filter((s) => s.id !== id));
  emit();
}

export function allSets(): SymbolSet[] {
  return [CLASSIC_SET, ...bundled, ...userSets()];
}

export function useSymbolSets(): SymbolSet[] {
  useEffect(() => {
    loadBundledSets();
  }, []);
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return allSets();
}
