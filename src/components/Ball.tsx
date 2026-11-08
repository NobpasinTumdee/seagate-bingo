import { columnHeader, columnOf, imageItem } from '../core/symbols';
import type { GameConfig } from '../core/types';
import { SymbolView } from './SymbolView';

export type SymbolCfg = Pick<GameConfig, 'mode' | 'size' | 'poolMin' | 'poolMax' | 'columns' | 'items' | 'freeCenter' | 'eventLogo'>;

/** Ball face content (number / logo + number / image) without the ball shell */
export function BallFace({ cfg, value }: { cfg: SymbolCfg; value: number }) {
  if (cfg.mode === 'image') {
    return (
      <span className="ball-face ball-face-image">
        <SymbolView item={imageItem(cfg, value)} />
      </span>
    );
  }
  const col = columnOf(cfg, value);
  const head = columnHeader(cfg, col);
  return (
    <span className="ball-face">
      {cfg.mode === 'columnLogo' ? (
        <SymbolView item={head} className="ball-logo" />
      ) : (
        <span className="ball-letter">{head.label}</span>
      )}
      <span className="ball-num">{value}</span>
    </span>
  );
}

/** Full styled ball (theme decides: platter / gold) */
export function Ball({ cfg, value, size = 120, className = '', pulse = false }: { cfg: SymbolCfg; value: number; size?: number; className?: string; pulse?: boolean }) {
  return (
    <span className={`ball ${pulse ? 'ball-pulse' : ''} ${className}`} style={{ width: size, height: size, fontSize: size / 100 + 'px' }}>
      <span className="ball-shell" />
      <span className="ball-hub">
        <BallFace cfg={cfg} value={value} />
      </span>
      <span className="ball-gloss" />
    </span>
  );
}
