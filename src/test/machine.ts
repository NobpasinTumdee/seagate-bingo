// Test helpers that simulate a separate "machine": fresh localStorage, fresh IndexedDB,
// fresh module state, and its own copy of the app's bundled /assets files.
import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

/** Bundled files served at /assets/... on this machine (path -> bytes) */
export type Assets = Record<string, Uint8Array>;

const realFetch = globalThis.fetch;

/** Wipe all storage and module state, and serve `assets` as this machine's public folder. */
export function bootMachine(assets: Assets) {
  vi.resetModules();
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  (globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory();
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('data:')) return realFetch(url);
    const bytes = assets[url];
    if (!bytes) return new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response(bytes, { status: 200, headers: { 'content-type': url.endsWith('.svg') ? 'image/svg+xml' : 'image/png' } });
  }) as typeof fetch;
}

export function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
