import { columnHeader, columnOf } from '../../core/symbols';
import type { SymbolItem } from '../../core/types';
import type { SymbolCfg } from '../Ball';

export type Rect = { x: number; y: number; w: number; h: number };
export type BoardLayout = {
  cells: Map<number, { x: number; y: number; s: number }>;
  headers: { x: number; y: number; w: number; h: number; item: SymbolItem }[];
};

/** Absolute positions (stage px) of every ball on the master board */
export function boardLayout(sym: SymbolCfg, area: Rect): BoardLayout {
  const cells = new Map<number, { x: number; y: number; s: number }>();
  const headers: BoardLayout['headers'] = [];
  const total = sym.poolMax - sym.poolMin + 1;
  if (sym.mode === 'image') {
    let best = { cols: 1, s: 0 };
    for (let cols = 1; cols <= total; cols++) {
      const rows = Math.ceil(total / cols);
      const s = Math.min(area.w / cols, area.h / rows);
      if (s > best.s) best = { cols, s };
    }
    const rows = Math.ceil(total / best.cols);
    const ox = area.x + (area.w - best.cols * best.s) / 2;
    const oy = area.y + (area.h - rows * best.s) / 2;
    for (let i = 0; i < total; i++) {
      const v = sym.poolMin + i;
      cells.set(v, { x: ox + (i % best.cols) * best.s + best.s / 2, y: oy + Math.floor(i / best.cols) * best.s + best.s / 2, s: best.s });
    }
    return { cells, headers };
  }
  const rows = sym.size;
  const per = Math.ceil(total / rows);
  const headerW0 = sym.mode === 'columnLogo' ? 200 : 110;
  const s = Math.min((area.w - headerW0 - 16) / per, area.h / rows);
  const headerW = sym.mode === 'columnLogo' ? headerW0 : Math.min(headerW0, Math.max(s * 1.3, 90));
  const gridW = per * s;
  const ox = area.x + (area.w - (headerW + 16 + gridW)) / 2;
  const oy = area.y + (area.h - rows * s) / 2;
  for (let r = 0; r < rows; r++) {
    headers.push({ x: ox, y: oy + r * s + s * 0.06, w: headerW, h: s * 0.88, item: columnHeader(sym, r) });
  }
  for (let v = sym.poolMin; v <= sym.poolMax; v++) {
    const r = columnOf(sym, v);
    const per2 = Math.floor(total / rows);
    const k = v - sym.poolMin - r * per2;
    cells.set(v, { x: ox + headerW + 16 + k * s + s / 2, y: oy + r * s + s / 2, s });
  }
  return { cells, headers };
}
