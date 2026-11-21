// Frozen card sets: generator versions, the binary card snapshot, the set code and check codes.
// Pure (no DOM, no storage). Everything here must be deterministic on every machine/engine.
import { base64ToBytes, bytesToBase64, concatBytes, sha256, utf8 } from './bytes';
import { CODE_ALPHABET, checkCode, getAllCards } from './cards';
import { cyrb128 } from './rng';
import type { Card, GameConfig, SymbolItem } from './types';

/**
 * 1 = the original generator (cards.ts, frozen as-is) + check code from (seed, card number).
 * 2 = same card algorithm (it was proven deterministic, see README), but the check code is bound to
 *     the set code and the card's content. Used for games generated after this change.
 */
export type GeneratorVersion = 1 | 2;
export const CURRENT_GENERATOR: GeneratorVersion = 2;

export type FrozenMeta = {
  generatorVersion: GeneratorVersion;
  /** XXXX-XXXX */
  setCode: string;
  origin: 'generated' | 'migrated' | 'imported';
  /** false = imported from an old (v1) backup: the printed cards cannot be guaranteed to match */
  verified: boolean;
  unverifiedReasons?: string[];
  /** show "please export a new backup" until the host exports or dismisses it */
  backupPending: boolean;
};

/** Cells of every card, row-major, one Uint16 per cell. FREE_CELL marks the free centre. */
export type CardSnapshot = {
  generatorVersion: GeneratorVersion;
  size: number;
  startNumber: number;
  count: number;
  cells: Uint16Array;
};

export const FREE_CELL = 0xffff;
export const MAX_BALL_VALUE = 0xfffe;
export const CELL_ENCODING = 'u16le-rowmajor-ffff=free';

export function generateCards(version: GeneratorVersion, cfg: GameConfig, seed: string, attempts: Record<number, number>): Card[] {
  // Both versions use the original, frozen cell generator. Never change cards.ts output:
  // golden tests in frozen.test.ts pin it.
  if (version !== 1 && version !== 2) throw new Error('unknown generator version ' + version);
  return getAllCards(cfg, seed, attempts);
}

export function encodeCards(version: GeneratorVersion, size: number, startNumber: number, cards: Card[]): CardSnapshot {
  const per = size * size;
  const cells = new Uint16Array(cards.length * per);
  cards.forEach((c, i) => {
    if (c.no !== startNumber + i) throw new Error('cards must be consecutive');
    if (c.cells.length !== per) throw new Error('bad card size');
    c.cells.forEach((v, k) => {
      if (v !== 0 && (!Number.isInteger(v) || v < 1 || v > MAX_BALL_VALUE)) throw new Error('cell value out of range: ' + v);
      cells[i * per + k] = v === 0 ? FREE_CELL : v;
    });
  });
  return { generatorVersion: version, size, startNumber, count: cards.length, cells };
}

export function cardAt(s: CardSnapshot, i: number): Card {
  const per = s.size * s.size;
  const cells = new Array<number>(per);
  for (let k = 0; k < per; k++) {
    const v = s.cells[i * per + k];
    cells[k] = v === FREE_CELL ? 0 : v;
  }
  return { no: s.startNumber + i, cells };
}

export function decodeCards(s: CardSnapshot): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < s.count; i++) out.push(cardAt(s, i));
  return out;
}

/** Explicit little-endian bytes (independent of the platform's endianness) */
export function cellBytes(cells: Uint16Array): Uint8Array {
  const out = new Uint8Array(cells.length * 2);
  for (let i = 0; i < cells.length; i++) {
    out[i * 2] = cells[i] & 255;
    out[i * 2 + 1] = cells[i] >>> 8;
  }
  return out;
}

export function cellsFromBytes(b: Uint8Array): Uint16Array {
  if (b.length % 2) throw new Error('bad cell data');
  const out = new Uint16Array(b.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = b[i * 2] | (b[i * 2 + 1] << 8);
  return out;
}

export const cellsToBase64 = (c: Uint16Array) => bytesToBase64(cellBytes(c));
export const cellsFromBase64 = (s: string) => cellsFromBytes(base64ToBytes(s));

export function snapshotsEqual(a: CardSnapshot, b: CardSnapshot): boolean {
  if (a.size !== b.size || a.startNumber !== b.startNumber || a.count !== b.count || a.cells.length !== b.cells.length) return false;
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false;
  return true;
}

// ---------- images in frozen configs ----------
// After freezing, every image ref in the config is content-addressed: `idb:sha_<sha256 hex>`.
// An image that could not be loaded when the set was frozen becomes `missing:<original ref>`
// (rendered as the text badge, exactly as that machine showed it). No image = ''.
export const SHA_PREFIX = 'sha_';
export const shaKey = (hex: string) => SHA_PREFIX + hex;
export const shaRef = (hex: string) => 'idb:' + shaKey(hex);
export const MISSING_PREFIX = 'missing:';

/** Hash identity of an image ref: sha hex, 'missing', or null for "no image" */
export function refIdentity(ref?: string): string | null {
  if (!ref) return null;
  if (ref.startsWith('idb:' + SHA_PREFIX)) return ref.slice(4 + SHA_PREFIX.length);
  if (ref.startsWith(MISSING_PREFIX)) return 'missing';
  return 'unfrozen:' + ref;
}

export function isFrozenRef(ref?: string): boolean {
  const id = refIdentity(ref);
  return id === null || !id.startsWith('unfrozen:');
}

/** Every image ref a config uses (order: logo, columns, items) */
export function configImageRefs(cfg: GameConfig): string[] {
  const out: string[] = [];
  if (cfg.eventLogo) out.push(cfg.eventLogo);
  cfg.columns.forEach((c) => c.image && out.push(c.image));
  cfg.items.forEach((c) => c.image && out.push(c.image));
  return out;
}

/** Return a copy of cfg with each image ref replaced by `map(ref)` */
export function mapConfigImages(cfg: GameConfig, map: (ref: string) => string): GameConfig {
  const fix = (it: SymbolItem): SymbolItem => (it.image ? { ...it, image: map(it.image) } : { ...it });
  return {
    ...cfg,
    eventLogo: cfg.eventLogo ? map(cfg.eventLogo) : '',
    eventDate: cfg.eventDate ?? '',
    columns: cfg.columns.map(fix),
    items: cfg.items.map(fix),
  };
}

// ---------- set code ----------
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}

const sym = (it: SymbolItem) => ({ id: it.id, label: it.label, speech: it.speech ?? '', image: refIdentity(it.image) });

/** Everything that appears on a printed card, besides the cells (which are hashed as bytes) */
export function setCodeHeader(version: GeneratorVersion, seed: string, cfg: GameConfig, snap: CardSnapshot) {
  return {
    format: 'bingo-set-code/1',
    generatorVersion: version,
    // v1 check codes are derived from the seed, so the seed is part of what was printed
    seed,
    config: {
      size: cfg.size,
      mode: cfg.mode,
      poolMin: cfg.poolMin,
      poolMax: cfg.poolMax,
      freeCenter: cfg.freeCenter,
      cardCount: cfg.cardCount,
      startNumber: cfg.startNumber,
      eventName: cfg.eventName,
      eventDate: cfg.eventDate ?? '',
      eventLogo: refIdentity(cfg.eventLogo),
    },
    symbols: { columns: cfg.columns.map(sym), items: cfg.items.map(sym) },
    cards: { encoding: CELL_ENCODING, size: snap.size, startNumber: snap.startNumber, count: snap.count },
  };
}

export function formatSetCode(hash: Uint8Array): string {
  // first 40 bits -> 8 symbols of 5 bits, unambiguous alphabet
  let bits = 0; // < 2^40, exact in a double
  for (let i = 0; i < 5; i++) bits = bits * 256 + hash[i];
  let s = '';
  for (let i = 7; i >= 0; i--) s += CODE_ALPHABET[Math.floor(bits / 2 ** (i * 5)) % 32];
  return s.slice(0, 4) + '-' + s.slice(4);
}

export async function computeSetCode(version: GeneratorVersion, seed: string, cfg: GameConfig, snap: CardSnapshot): Promise<string> {
  const head = utf8(canonical(setCodeHeader(version, seed, cfg, snap)));
  const hash = await sha256(concatBytes([head, new Uint8Array([0]), cellBytes(snap.cells)]));
  return formatSetCode(hash);
}

// ---------- check codes ----------
export function checkCodeV2(setCode: string, card: Card): string {
  const [a, b] = cyrb128(`${setCode}#check2#${card.no}#${card.cells.join(',')}`);
  const x = a ^ Math.imul(b, 0x9e3779b1);
  let out = '';
  for (let i = 0; i < 4; i++) out += CODE_ALPHABET[(x >>> (i * 5)) & 31];
  return out;
}

/** The check code printed on `card` for this game (formula depends on the generator version) */
export function cardCode(g: { seed: string | null; frozen?: FrozenMeta | null }, card: Card): string {
  if (g.frozen?.generatorVersion === 2) return checkCodeV2(g.frozen.setCode, card);
  return checkCode(g.seed ?? '', card.no);
}
