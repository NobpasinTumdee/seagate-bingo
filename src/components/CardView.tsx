import { memo } from 'react';
import { formatCardNo } from '../core/cards';
import { columnHeader, imageItem } from '../core/symbols';
import type { Card } from '../core/types';
import { t } from '../i18n/th';
import type { SymbolCfg } from './Ball';
import { SymbolView } from './SymbolView';

type Props = {
  cfg: SymbolCfg & { eventName: string; eventDate?: string };
  card: Card;
  code?: string;
  drawn?: Set<number>;
  highlight?: number[];
  variant?: 'color' | 'ink';
  showMeta?: boolean;
  className?: string;
};

function CardViewImpl({ cfg, card, code, drawn, highlight, variant = 'color', showMeta = true, className = '' }: Props) {
  const n = cfg.size;
  const hl = new Set(highlight ?? []);
  const columnMode = cfg.mode !== 'image';
  return (
    <div className={`bcard-box ${className}`}>
    <div className={`bcard bcard-${variant}`} style={{ ['--n' as string]: n }}>
      {showMeta && (
        <div className="bcard-head">
          {cfg.eventLogo && <SymbolView item={{ id: 'logo', label: '', image: cfg.eventLogo }} className="bcard-logo" badge={false} />}
          <div className="bcard-title">
            <div className="bcard-event">{cfg.eventName}</div>
            {cfg.eventDate && <div className="bcard-date">{cfg.eventDate}</div>}
          </div>
        </div>
      )}
      <div className="bcard-grid">
        {columnMode
          ? Array.from({ length: n }, (_, c) => {
              const h = columnHeader(cfg, c);
              return (
                <div key={'h' + c} className="bcard-h">
                  {cfg.mode === 'columnLogo' ? <SymbolView item={h} /> : <span>{h.label}</span>}
                </div>
              );
            })
          : (
            <div className="bcard-h bcard-h-wide" style={{ gridColumn: `span ${n}` }}>
              <span>BINGO</span>
            </div>
          )}
        {card.cells.map((v, i) => {
          const isFree = v === 0;
          const isMarked = isFree || (drawn?.has(v) ?? false);
          return (
            <div key={i} className={`bcard-c ${isFree ? 'free' : ''} ${drawn && isMarked ? 'marked' : ''} ${hl.has(i) ? 'win' : ''}`}>
              {isFree ? (
                cfg.eventLogo && cfg.mode === 'number' ? (
                  <SymbolView item={{ id: 'free', label: 'FREE', image: cfg.eventLogo }} />
                ) : (
                  <span className="free-label">FREE</span>
                )
              ) : cfg.mode === 'image' ? (
                <SymbolView item={imageItem(cfg, v)} />
              ) : (
                <span className="num">{v}</span>
              )}
            </div>
          );
        })}
      </div>
      {showMeta && (
        <div className="bcard-foot">
          <span className="bcard-rules">{t.print.rulesOnScreen}</span>
          <span className="bcard-no">
            {formatCardNo(card.no)}
            {code && <b className="bcard-code">{code}</b>}
          </span>
        </div>
      )}
    </div>
    </div>
  );
}

export const CardView = memo(CardViewImpl);
