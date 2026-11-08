import { useEffect, useRef, useState } from 'react';
import { Stage } from '../components/stage/Stage';
import { audioUnlocked, unlockAudio } from '../components/stage/audio';
import { t } from '../i18n/th';
import type { PublicState } from '../state/publicState';
import { createViewer, loadPublicState } from '../state/sync';
import { applyTheme, getTheme } from '../themes';

export default function DisplayPage() {
  const [ps, setPs] = useState<PublicState | null>(null);
  const [alive, setAlive] = useState(false);
  const lastSeen = useRef(0);
  const [showUi, setShowUi] = useState(true);
  const [soundHint, setSoundHint] = useState(true);
  const gotLive = useRef(false);

  useEffect(() => {
    const v = createViewer(
      (s) => {
        gotLive.current = true;
        setPs(s);
      },
      () => {
        lastSeen.current = Date.now();
        setAlive(true);
      },
    );
    // no host yet → fall back to the last public state saved in localStorage
    const fallback = setTimeout(() => {
      if (!gotLive.current) {
        const saved = loadPublicState();
        if (saved) setPs(saved);
      }
    }, 700);
    const iv = setInterval(() => {
      if (Date.now() - lastSeen.current > 6000) {
        setAlive(false);
        v.request();
      }
    }, 2000);
    return () => {
      clearTimeout(fallback);
      clearInterval(iv);
      v.close();
    };
  }, []);

  useEffect(() => {
    applyTheme(getTheme(ps?.themeId));
  }, [ps?.themeId]);

  // fullscreen button + cursor auto-hide after 3 s without mouse movement
  useEffect(() => {
    let tm = window.setTimeout(() => setShowUi(false), 3000);
    const move = () => {
      setShowUi(true);
      clearTimeout(tm);
      tm = window.setTimeout(() => setShowUi(false), 3000);
    };
    window.addEventListener('mousemove', move);
    return () => {
      clearTimeout(tm);
      window.removeEventListener('mousemove', move);
    };
  }, []);

  // keep the screen awake
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const req = async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        /* not supported / denied */
      }
    };
    req();
    const vis = () => document.visibilityState === 'visible' && req();
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      lock?.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    document.title = 'BINGO — ' + (ps?.eventName ?? 'Display');
  }, [ps?.eventName]);

  const unlock = () => {
    unlockAudio();
    setTimeout(() => setSoundHint(!audioUnlocked()), 200);
  };

  const fullscreen = () => {
    unlock();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <div className={`display-root ${showUi ? '' : 'hide-cursor'}`} onClick={unlock}>
      <Stage ps={ps} waiting={!alive} />
      <div className={`display-ui ${showUi ? 'show' : ''}`}>
        <button className="btn" onClick={(e) => { e.stopPropagation(); fullscreen(); }}>⛶ {t.display.fullscreen}</button>
      </div>
      {soundHint && ps?.settings.sound && <div className={`sound-hint ${showUi ? 'show' : ''}`}>🔊 {t.display.tapForSound}</div>}
    </div>
  );
}
