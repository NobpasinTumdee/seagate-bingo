import { useEffect, useRef, useState } from 'react';
import type { RoundEstimate } from '../core/estimate';
import { validatePool } from '../core/symbols';
import type { GameConfig } from '../core/types';
import { t } from '../i18n/th';

export function Estimator({ cfg }: { cfg: GameConfig }) {
  const [result, setResult] = useState<RoundEstimate[] | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);

  // only the fields that influence the simulation
  const key = JSON.stringify([cfg.size, cfg.mode, cfg.poolMin, cfg.poolMax, cfg.freeCenter, cfg.cardCount, cfg.items.length, cfg.allowRepeatWinners, cfg.rounds.map((r) => [r.patternIds, r.winnersWanted]), cfg.customPatterns, tick]);

  useEffect(() => {
    if (validatePool(cfg).length) {
      setResult(null);
      return;
    }
    const timer = setTimeout(() => {
      workerRef.current?.terminate();
      const w = new Worker(new URL('../workers/estimate.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = w;
      const id = ++reqId.current;
      setProgress(0);
      setError(null);
      w.onmessage = (e) => {
        if (e.data.id !== id) return;
        if (e.data.progress !== undefined) setProgress(e.data.progress);
        if (e.data.result) {
          setResult(e.data.result);
          setProgress(null);
          w.terminate();
        }
        if (e.data.error) {
          setError(e.data.error);
          setProgress(null);
        }
      };
      w.postMessage({ id, cfg, games: 300 });
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  return (
    <div className="estimator">
      <div className="row between">
        <h3>{t.setup.estimator}</h3>
        <button className="btn btn-s" onClick={() => setTick((x) => x + 1)} disabled={progress !== null}>
          {progress !== null ? `${t.setup.estimating} ${Math.round(progress * 100)}%` : t.setup.runEstimate}
        </button>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {result && (
        <div className={`est-rows ${progress !== null ? 'stale' : ''}`}>
          {cfg.rounds.map((r, i) => {
            const e = result[i];
            if (!e) return null;
            return (
              <div key={r.id} className={`est-row lvl-${e.level}`}>
                <b>{r.name}</b>
                <span>{t.setup.firstWin(e.mean, e.p10, e.p90)}</span>
                <span>{t.setup.multiWin(e.multiChance * 100)}</span>
                {e.level !== 'ok' && <span className="est-warn">⚠ {t.setup.estWarn}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
