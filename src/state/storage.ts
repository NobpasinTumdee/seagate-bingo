// localStorage helpers with failure reporting
type Listener = (msg: string | null) => void;
const listeners = new Set<Listener>();
let lastWarning: string | null = null;

export function onStorageWarning(fn: Listener): () => void {
  listeners.add(fn);
  fn(lastWarning);
  return () => listeners.delete(fn);
}

export function setStorageWarning(msg: string | null) {
  lastWarning = msg;
  listeners.forEach((l) => l(msg));
}

export function readJSON<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export const STORAGE_FAIL = 'fail';
export const STORAGE_FULL = 'full';

export function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (lastWarning === STORAGE_FAIL) setStorageWarning(null);
    return true;
  } catch {
    setStorageWarning(STORAGE_FAIL);
    return false;
  }
}

export function removeKey(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Approximate bytes used by localStorage (UTF-16) */
export function localStorageUsage(): number {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      total += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2;
    }
  } catch {
    /* ignore */
  }
  return total;
}

export async function checkStorageHealth() {
  const used = localStorageUsage();
  // most browsers allow ~5 MB of characters (~10 MB UTF-16)
  if (used > 8 * 1024 * 1024) setStorageWarning(STORAGE_FULL);
  try {
    const est = await navigator.storage?.estimate?.();
    if (est && est.quota && est.usage && est.usage / est.quota > 0.9) setStorageWarning(STORAGE_FULL);
  } catch {
    /* ignore */
  }
}
