import { useState } from 'react';
import type { SymbolItem } from '../core/types';
import { useImageUrl } from '../state/images';

/** Renders an image symbol, falling back to a styled text badge when missing/broken. */
export function SymbolView({ item, className = '', badge = true }: { item?: SymbolItem; className?: string; badge?: boolean }) {
  const url = useImageUrl(item?.image);
  const [failed, setFailed] = useState<string | null>(null);
  const label = item?.label ?? '?';
  const broken = !url || failed === url;
  return (
    <span className={'sym ' + className} title={label}>
      {!broken ? (
        <img src={url!} alt={label} draggable={false} onError={() => setFailed(url)} />
      ) : badge ? (
        <span className="sym-badge" style={{ fontSize: `min(${Math.round(150 / Math.max(3, label.length))}cqw, 46cqh)` }}>
          {label}
        </span>
      ) : null}
    </span>
  );
}
