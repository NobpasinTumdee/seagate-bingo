// Page layouts for printing / PDF (all units in millimetres)
import type { CardSize } from '../core/types';

export type PageLayout = {
  pageW: number;
  pageH: number;
  margin: number;
  cols: number;
  rows: number;
  gap: number;
};

export const A4 = { w: 210, h: 297 };

/** Cards per page on A4 portrait. Edit here to change the layout. */
export const LAYOUTS: Record<CardSize, PageLayout> = {
  3: { pageW: A4.w, pageH: A4.h, margin: 8, cols: 2, rows: 4, gap: 6 },
  4: { pageW: A4.w, pageH: A4.h, margin: 8, cols: 2, rows: 3, gap: 6 },
  5: { pageW: A4.w, pageH: A4.h, margin: 8, cols: 2, rows: 2, gap: 8 },
  6: { pageW: A4.w, pageH: A4.h, margin: 8, cols: 2, rows: 2, gap: 8 },
};

export function perPage(l: PageLayout): number {
  return l.cols * l.rows;
}

export type Slot = { x: number; y: number; w: number; h: number };

/** Slot rectangles of one page */
export function pageSlots(l: PageLayout): Slot[] {
  const w = (l.pageW - 2 * l.margin - (l.cols - 1) * l.gap) / l.cols;
  const h = (l.pageH - 2 * l.margin - (l.rows - 1) * l.gap) / l.rows;
  const out: Slot[] = [];
  for (let r = 0; r < l.rows; r++)
    for (let c = 0; c < l.cols; c++) out.push({ x: l.margin + c * (w + l.gap), y: l.margin + r * (h + l.gap), w, h });
  return out;
}

/**
 * Card box inside a slot. The card keeps a fixed aspect so cells stay square:
 * height = head + header row + n cells + foot.
 */
export function cardBox(slot: Slot, n: number): Slot & { cell: number; head: number; colHead: number; foot: number; pad: number } {
  // relative units: card width W = pad*2 + n*cell
  const fit = (W: number) => {
    const pad = W * 0.045;
    const cell = (W - 2 * pad) / n;
    const head = W * 0.15;
    const colHead = Math.max(cell * 0.55, W * 0.09);
    const foot = W * 0.075;
    const H = pad + head + colHead + n * cell + foot + pad * 0.6;
    return { pad, cell, head, colHead, foot, H };
  };
  let W = slot.w;
  let f = fit(W);
  if (f.H > slot.h) {
    W = W * (slot.h / f.H);
    f = fit(W);
  }
  const x = slot.x + (slot.w - W) / 2;
  const y = slot.y + (slot.h - f.H) / 2;
  return { x, y, w: W, h: f.H, cell: f.cell, head: f.head, colHead: f.colHead, foot: f.foot, pad: f.pad };
}
