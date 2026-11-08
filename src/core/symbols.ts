// Symbol / pool helpers (pure)
import type { CardSize, GameConfig, SymbolItem } from './types';

export const DEFAULT_POOL: Record<CardSize, number> = { 3: 30, 4: 48, 5: 75, 6: 90 };

export function poolSize(cfg: Pick<GameConfig, 'poolMin' | 'poolMax'>): number {
  return cfg.poolMax - cfg.poolMin + 1;
}

export function allBalls(cfg: Pick<GameConfig, 'poolMin' | 'poolMax'>): number[] {
  const out: number[] = [];
  for (let v = cfg.poolMin; v <= cfg.poolMax; v++) out.push(v);
  return out;
}

export function hasFreeCell(cfg: Pick<GameConfig, 'size' | 'freeCenter'>): boolean {
  return cfg.freeCenter && cfg.size % 2 === 1;
}

export function centerIndex(size: number): number {
  return Math.floor(size / 2) * size + Math.floor(size / 2);
}

export function isColumnMode(cfg: Pick<GameConfig, 'mode'>): boolean {
  return cfg.mode === 'number' || cfg.mode === 'columnLogo';
}

/** [min, max] inclusive range for column c */
export function columnRange(cfg: Pick<GameConfig, 'poolMin' | 'poolMax' | 'size'>, c: number): [number, number] {
  const per = Math.floor(poolSize(cfg) / cfg.size);
  const lo = cfg.poolMin + c * per;
  return [lo, lo + per - 1];
}

export function columnOf(cfg: Pick<GameConfig, 'poolMin' | 'poolMax' | 'size'>, v: number): number {
  const per = Math.floor(poolSize(cfg) / cfg.size);
  return Math.min(cfg.size - 1, Math.floor((v - cfg.poolMin) / per));
}

export const BINGO_LETTERS: Record<CardSize, string[]> = {
  3: ['B', 'N', 'O'],
  4: ['B', 'I', 'N', 'G'],
  5: ['B', 'I', 'N', 'G', 'O'],
  6: ['B', 'I', 'N', 'G', 'O', '!'],
};

/** Column header item for column c (letters in number mode, logos in columnLogo) */
export function columnHeader(cfg: Pick<GameConfig, 'mode' | 'columns' | 'size'>, c: number): SymbolItem {
  if (cfg.mode === 'columnLogo' && cfg.columns[c]) return cfg.columns[c];
  return { id: 'letter' + c, label: BINGO_LETTERS[cfg.size][c] ?? String(c + 1) };
}

/** Image item for ball value (image mode) */
export function imageItem(cfg: Pick<GameConfig, 'items' | 'poolMin'>, v: number): SymbolItem | undefined {
  return cfg.items[v - cfg.poolMin];
}

/** Plain-text label of a ball, used for logs and voice */
export function ballLabel(cfg: GameConfig, v: number): string {
  if (cfg.mode === 'image') return imageItem(cfg, v)?.label ?? String(v);
  if (cfg.mode === 'columnLogo') return `${columnHeader(cfg, columnOf(cfg, v)).label} ${v}`;
  return `${BINGO_LETTERS[cfg.size][columnOf(cfg, v)] ?? ''}-${v}`;
}

const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];

/** Thai words for 0..999 (enough for bingo pools) */
export function thaiNumber(n: number): string {
  if (n < 10) return DIGITS[n];
  let out = '';
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  if (h) out += DIGITS[h] + 'ร้อย';
  if (t === 1) out += 'สิบ';
  else if (t === 2) out += 'ยี่สิบ';
  else if (t) out += DIGITS[t] + 'สิบ';
  if (u === 1 && (t || h)) out += 'เอ็ด';
  else if (u) out += DIGITS[u];
  return out;
}

/** Text spoken by the Thai voice call-out */
export function ballSpeech(cfg: GameConfig, v: number): string {
  if (cfg.mode === 'image') {
    const it = imageItem(cfg, v);
    return it?.speech || it?.label || thaiNumber(v);
  }
  if (cfg.mode === 'columnLogo') {
    const h = columnHeader(cfg, columnOf(cfg, v));
    return `${h.speech || h.label} ${thaiNumber(v)}`;
  }
  return thaiNumber(v);
}

/** Validate pool vs. card configuration. Returns list of error messages (Thai). */
export function validatePool(cfg: GameConfig): string[] {
  const errs: string[] = [];
  const cells = cfg.size * cfg.size - (hasFreeCell(cfg) ? 1 : 0);
  if (cfg.mode === 'image') {
    if (cfg.items.length < cells)
      errs.push(`ต้องมีรูปอย่างน้อย ${cells} รูป (ตอนนี้มี ${cfg.items.length})`);
    return errs;
  }
  const ps = poolSize(cfg);
  if (!Number.isInteger(cfg.poolMin) || !Number.isInteger(cfg.poolMax) || cfg.poolMin < 0)
    errs.push('ช่วงตัวเลขไม่ถูกต้อง');
  if (ps < cfg.size * cfg.size) errs.push(`จำนวนลูกต้องไม่น้อยกว่า ${cfg.size * cfg.size}`);
  if (ps % cfg.size !== 0) errs.push(`จำนวนลูก (${ps}) ต้องหารด้วย ${cfg.size} ลงตัว`);
  if (cfg.mode === 'columnLogo' && cfg.columns.length < cfg.size)
    errs.push(`โหมดโลโก้ประจำคอลัมน์ต้องมีโลโก้ ${cfg.size} อัน (ตอนนี้มี ${cfg.columns.length})`);
  return errs;
}

export function poolWarnings(cfg: GameConfig): string[] {
  const w: string[] = [];
  const cells = cfg.size * cfg.size - (hasFreeCell(cfg) ? 1 : 0);
  if (cfg.mode === 'image' && cfg.items.length >= cells && cfg.items.length < cells * 3)
    w.push('จำนวนรูปน้อยกว่า 3 เท่าของช่องบนใบ เกมจะจบเร็วและมีผู้ชนะพร้อมกันหลายใบ');
  return w;
}
