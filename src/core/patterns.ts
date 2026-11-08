// Winning patterns as bitmasks. Up to 36 cells -> split into lo (bits 0..31) / hi (bits 32..35).
import type { CardSize, PatternDef } from './types';

export type Mask = { lo: number; hi: number; count: number };
/** A pattern is satisfied if ANY of its alternative masks is fully marked */
export type CompiledPattern = { id: string; name: string; masks: Mask[]; cells: number[] /* preview cells */ };

export const BUILTIN_PATTERNS: { id: string; name: string }[] = [
  { id: 'anyRow', name: 'แถวนอนใดก็ได้' },
  { id: 'anyCol', name: 'แถวตั้งใดก็ได้' },
  { id: 'anyDiag', name: 'แนวทแยงใดก็ได้' },
  { id: 'anyLine', name: 'เส้นใดก็ได้ (นอน/ตั้ง/ทแยง)' },
  { id: 'twoLines', name: 'สองเส้น' },
  { id: 'fourCorners', name: 'สี่มุม' },
  { id: 'x', name: 'ตัว X' },
  { id: 'frame', name: 'กรอบนอก' },
  { id: 'plus', name: 'เครื่องหมายบวก (+)' },
  { id: 'blackout', name: 'เต็มใบ' },
];

export function maskFromCells(cells: number[]): Mask {
  let lo = 0,
    hi = 0;
  const uniq = Array.from(new Set(cells));
  for (const i of uniq) {
    if (i < 32) lo |= 1 << i;
    else hi |= 1 << (i - 32);
  }
  return { lo: lo >>> 0, hi: hi >>> 0, count: uniq.length };
}

export function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function maskCells(m: Mask): number[] {
  const out: number[] = [];
  for (let i = 0; i < 32; i++) if (m.lo & (1 << i)) out.push(i);
  for (let i = 0; i < 4; i++) if (m.hi & (1 << i)) out.push(32 + i);
  return out;
}

function rows(n: number): number[][] {
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => r * n + c));
}
function cols(n: number): number[][] {
  return Array.from({ length: n }, (_, c) => Array.from({ length: n }, (_, r) => r * n + c));
}
function diags(n: number): number[][] {
  return [
    Array.from({ length: n }, (_, i) => i * n + i),
    Array.from({ length: n }, (_, i) => i * n + (n - 1 - i)),
  ];
}

/** Cells of the plus pattern (two middle rows/cols for even sizes) */
function plusCells(n: number): number[] {
  const mids = n % 2 ? [Math.floor(n / 2)] : [n / 2 - 1, n / 2];
  const out: number[] = [];
  for (const m of mids) for (let i = 0; i < n; i++) out.push(m * n + i, i * n + m);
  return out;
}

function frameCells(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i, (n - 1) * n + i, i * n, i * n + n - 1);
  return out;
}

/**
 * Compile a pattern into alternative masks. `freeCells` are pre-marked on cards but still
 * part of the masks (they're simply always marked).
 */
export function compilePattern(id: string, size: CardSize, custom: PatternDef[] = []): CompiledPattern {
  const n = size;
  const all = Array.from({ length: n * n }, (_, i) => i);
  const lines = [...rows(n), ...cols(n), ...diags(n)];
  const name = BUILTIN_PATTERNS.find((p) => p.id === id)?.name ?? custom.find((p) => p.id === id)?.name ?? id;
  let alts: number[][];
  switch (id) {
    case 'anyRow': alts = rows(n); break;
    case 'anyCol': alts = cols(n); break;
    case 'anyDiag': alts = diags(n); break;
    case 'anyLine': alts = lines; break;
    case 'twoLines': {
      alts = [];
      for (let i = 0; i < lines.length; i++)
        for (let j = i + 1; j < lines.length; j++) alts.push([...lines[i], ...lines[j]]);
      break;
    }
    case 'fourCorners': alts = [[0, n - 1, (n - 1) * n, n * n - 1]]; break;
    case 'x': alts = [[...diags(n)[0], ...diags(n)[1]]]; break;
    case 'frame': alts = [frameCells(n)]; break;
    case 'plus': alts = [plusCells(n)]; break;
    case 'blackout': alts = [all]; break;
    default: {
      const def = custom.find((p) => p.id === id);
      if (!def || !def.cells || def.cells.length === 0 || (def.size && def.size !== size)) alts = [];
      else alts = [def.cells.filter((c) => c >= 0 && c < n * n)];
    }
  }
  const masks = alts.map(maskFromCells);
  // preview: for "any" patterns show the first alternative; twoLines -> first two rows
  let preview = alts[0] ?? [];
  if (id === 'twoLines') preview = [...rows(n)[0], ...rows(n)[n - 1]];
  if (id === 'anyLine') preview = rows(n)[Math.floor(n / 2)];
  return { id, name, masks, cells: Array.from(new Set(preview)) };
}

/** Compile all patterns of a round (any of them wins) into one flat list of masks */
export function compileRound(patternIds: string[], size: CardSize, custom: PatternDef[] = []): CompiledPattern {
  const parts = patternIds.map((id) => compilePattern(id, size, custom));
  const seen = new Set<string>();
  const masks: Mask[] = [];
  for (const p of parts)
    for (const m of p.masks) {
      const k = m.lo + ':' + m.hi;
      if (!seen.has(k)) {
        seen.add(k);
        masks.push(m);
      }
    }
  return {
    id: patternIds.join('+'),
    name: parts.map((p) => p.name).join(' หรือ '),
    masks,
    cells: parts[0]?.cells ?? [],
  };
}

/** Is the given marked mask satisfying any alternative? Returns the matching mask or null. */
export function matchMask(lo: number, hi: number, pattern: CompiledPattern): Mask | null {
  for (const m of pattern.masks) if ((lo & m.lo) >>> 0 === m.lo && (hi & m.hi) >>> 0 === m.hi) return m;
  return null;
}

/** Minimum number of unmarked cells needed to complete the pattern */
export function missingCount(lo: number, hi: number, pattern: CompiledPattern): number {
  let best = Infinity;
  for (const m of pattern.masks) {
    const miss = popcount((m.lo & ~lo) >>> 0) + popcount((m.hi & ~hi) >>> 0);
    if (miss < best) {
      best = miss;
      if (best === 0) break;
    }
  }
  return best;
}

/** Grid of cells to display in mini pattern previews */
export function previewGrid(pattern: CompiledPattern, size: CardSize): boolean[] {
  const set = new Set(pattern.cells);
  return Array.from({ length: size * size }, (_, i) => set.has(i));
}
