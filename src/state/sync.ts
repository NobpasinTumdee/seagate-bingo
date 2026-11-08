// Two-window sync on one machine: BroadcastChannel, falling back to `storage` events.
import { withoutTransient, type PublicState } from './publicState';

const CHANNEL = 'bingo-sync-v1';
const PUBLIC_KEY = 'bingo:public';
const PING_KEY = 'bingo:ping';

type Msg = { type: 'state'; state: PublicState } | { type: 'request' } | { type: 'ping'; t: number };

const hasBC = typeof BroadcastChannel !== 'undefined';

export function savePublicState(s: PublicState) {
  try {
    // reveal / show-card overlays are not stored, so a Display that falls back to storage
    // (no Control window open) never replays or gets stuck on an old overlay
    localStorage.setItem(PUBLIC_KEY, JSON.stringify(withoutTransient(s)));
  } catch {
    /* ignore — display fallback only */
  }
}

export function loadPublicState(): PublicState | null {
  try {
    const s = localStorage.getItem(PUBLIC_KEY);
    return s ? withoutTransient(JSON.parse(s) as PublicState) : null;
  } catch {
    return null;
  }
}

/** Host side (Control). */
export function createHost(getState: () => PublicState | null) {
  const ch = hasBC ? new BroadcastChannel(CHANNEL) : null;
  if (ch)
    ch.onmessage = (e: MessageEvent<Msg>) => {
      if (e.data?.type === 'request') {
        const s = getState();
        if (s) ch.postMessage({ type: 'state', state: s } satisfies Msg);
      }
    };
  const ping = setInterval(() => {
    if (ch) ch.postMessage({ type: 'ping', t: Date.now() } satisfies Msg);
    else
      try {
        localStorage.setItem(PING_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
  }, 2000);
  return {
    publish(s: PublicState) {
      savePublicState(s);
      ch?.postMessage({ type: 'state', state: s } satisfies Msg);
    },
    close() {
      clearInterval(ping);
      ch?.close();
    },
  };
}

/** Viewer side (Display). */
export function createViewer(onState: (s: PublicState) => void, onAlive: () => void) {
  const ch = hasBC ? new BroadcastChannel(CHANNEL) : null;
  if (ch) {
    ch.onmessage = (e: MessageEvent<Msg>) => {
      if (e.data?.type === 'state') {
        onAlive();
        onState(e.data.state);
      } else if (e.data?.type === 'ping') onAlive();
    };
    ch.postMessage({ type: 'request' } satisfies Msg);
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === PUBLIC_KEY && e.newValue && !ch) {
      try {
        onState(JSON.parse(e.newValue));
        onAlive();
      } catch {
        /* ignore */
      }
    }
    if (e.key === PING_KEY) onAlive();
  };
  window.addEventListener('storage', onStorage);
  return {
    request() {
      ch?.postMessage({ type: 'request' } satisfies Msg);
    },
    close() {
      ch?.close();
      window.removeEventListener('storage', onStorage);
    },
  };
}
