// Resolution math for Thai strings that are rasterized in the PDF (pure, unit-tested).

export const MIN_TEXT_DPI = 300;
/** We aim higher than the minimum so a slightly shrunk string still stays above 300 DPI. */
export const TARGET_TEXT_DPI = 450;
/** canvas height = font px × LINE_FACTOR (room for Thai upper/lower marks) */
export const LINE_FACTOR = 1.5;
/** Browsers cap canvas dimensions; stay well below every engine's limit. */
export const MAX_CANVAS_PX = 12000;

const MM_PER_INCH = 25.4;

/** Font size (CSS px) to render a string whose printed line box is `heightMm` tall */
export function rasterFontPx(heightMm: number, dpi = TARGET_TEXT_DPI): number {
  const pxHeight = (heightMm / MM_PER_INCH) * dpi;
  return Math.max(32, Math.ceil(pxHeight / LINE_FACTOR));
}

/** Effective DPI of a raster `pxHeight` tall printed at `heightMm` (width scales identically) */
export function effectiveDpi(pxHeight: number, heightMm: number): number {
  return pxHeight / (heightMm / MM_PER_INCH);
}
