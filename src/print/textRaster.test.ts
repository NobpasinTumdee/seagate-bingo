import { describe, expect, it } from 'vitest';
import { cardBox, LAYOUTS, pageSlots } from './layouts';
import { effectiveDpi, LINE_FACTOR, MIN_TEXT_DPI, rasterFontPx, TARGET_TEXT_DPI } from './textRaster';

const PT_PER_MM = 72 / 25.4;

describe('rasterized Thai text resolution', () => {
  it('is >= 300 DPI for any printed height', () => {
    for (let h = 0.3; h <= 80; h += 0.1) {
      const pxH = Math.ceil(rasterFontPx(h) * LINE_FACTOR);
      expect(effectiveDpi(pxH, h)).toBeGreaterThanOrEqual(MIN_TEXT_DPI);
      expect(effectiveDpi(pxH, h)).toBeGreaterThanOrEqual(TARGET_TEXT_DPI - 1);
    }
  });

  it('covers the real title/date sizes of every A4 layout', () => {
    for (const size of [3, 4, 5, 6] as const) {
      const box = cardBox(pageSlots(LAYOUTS[size])[0], size);
      for (const factor of [0.46, 0.38, 0.38 * 0.55]) {
        const hMm = ((box.head * PT_PER_MM * factor) / PT_PER_MM) * LINE_FACTOR;
        const pxH = Math.ceil(rasterFontPx(hMm) * LINE_FACTOR);
        expect(effectiveDpi(pxH, hMm)).toBeGreaterThanOrEqual(MIN_TEXT_DPI);
      }
    }
  });
});
