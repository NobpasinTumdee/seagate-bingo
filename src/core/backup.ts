// Backup (de)serialization – pure. Image bytes are passed in/out as data URLs.
import { migrateGame, SCHEMA_VERSION, type GameRecord } from './game';
import { CELL_ENCODING, cellsFromBase64, cellsToBase64, type CardSnapshot, type GeneratorVersion } from './frozen';

export const BACKUP_FORMAT = 'newyear-bingo-backup';
/** 1 = game record only (cards rebuilt from the seed); 2 = adds the frozen card snapshot + set code */
export const BACKUP_VERSION = 2;

export type BackupCards = {
  encoding: typeof CELL_ENCODING;
  size: number;
  startNumber: number;
  count: number;
  /** base64 of the little-endian Uint16 cells */
  data: string;
};

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: number;
  schemaVersion: number;
  exportedAt: number;
  game: GameRecord;
  /** v2: generator version and set code of the frozen cards (also inside game.frozen) */
  generatorVersion?: GeneratorVersion;
  setCode?: string;
  cards?: BackupCards;
  /** idb key -> data URL. In v2 every key is `sha_<sha256 of the bytes>` */
  images: Record<string, string>;
};

/** Every `idb:<key>` image reference used by the game config */
export function collectImageRefs(g: GameRecord): string[] {
  const refs = new Set<string>();
  const add = (s?: string) => {
    if (s && s.startsWith('idb:')) refs.add(s.slice(4));
  };
  add(g.config.eventLogo);
  g.config.columns.forEach((c) => add(c.image));
  g.config.items.forEach((c) => add(c.image));
  return [...refs];
}

/** v1 file (kept for tests and for games that were never generated) */
export function createBackup(g: GameRecord, images: Record<string, string>, now: number): BackupFile {
  return { format: BACKUP_FORMAT, version: 1, schemaVersion: SCHEMA_VERSION, exportedAt: now, game: g, images };
}

export function createBackupV2(g: GameRecord, snap: CardSnapshot, images: Record<string, string>, now: number): BackupFile {
  if (!g.frozen) throw new Error('game is not frozen');
  return {
    format: BACKUP_FORMAT,
    version: 2,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    game: g,
    generatorVersion: g.frozen.generatorVersion,
    setCode: g.frozen.setCode,
    cards: { encoding: CELL_ENCODING, size: snap.size, startNumber: snap.startNumber, count: snap.count, data: cellsToBase64(snap.cells) },
    images,
  };
}

export function serializeBackup(b: BackupFile): string {
  return JSON.stringify(b);
}

export type ParsedBackup = BackupFile & {
  /** decoded card snapshot (v2 only) */
  snapshot: CardSnapshot | null;
  /** config keys missing from the raw file before defaults were filled in (v1 diagnostics) */
  missingConfigKeys: string[];
};

export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('ไฟล์ไม่ใช่ JSON ที่ถูกต้อง');
  }
  const b = raw as Partial<BackupFile>;
  if (!b || b.format !== BACKUP_FORMAT) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของเกมบิงโก');
  if (!b.game || typeof b.game !== 'object' || !(b.game as GameRecord).config) throw new Error('ไฟล์สำรองไม่มีข้อมูลเกม');
  const version = b.version ?? 1;
  if (version > BACKUP_VERSION) throw new Error('ไฟล์สำรองนี้มาจากแอปรุ่นใหม่กว่า กรุณาอัปเดตแอปก่อน');
  const rawCfg = (b.game as GameRecord).config as unknown as Record<string, unknown>;
  const missingConfigKeys = ['eventLogo', 'columns', 'items'].filter((k) => !(k in rawCfg));
  let snapshot: CardSnapshot | null = null;
  if (version >= 2) {
    const c = b.cards;
    const fz = (b.game as GameRecord).frozen;
    if (!c || !fz || !b.setCode || !b.generatorVersion) throw new Error('ไฟล์สำรองรุ่น 2 ไม่ครบ (ไม่มีข้อมูลใบ) — ไฟล์อาจเสียหาย');
    if (c.encoding !== CELL_ENCODING) throw new Error('รูปแบบข้อมูลใบไม่รองรับ');
    let cells: Uint16Array;
    try {
      cells = cellsFromBase64(c.data);
    } catch {
      throw new Error('ข้อมูลใบในไฟล์เสียหาย');
    }
    if (cells.length !== c.count * c.size * c.size) throw new Error('ข้อมูลใบในไฟล์เสียหาย (จำนวนช่องไม่ตรง)');
    snapshot = { generatorVersion: b.generatorVersion, size: c.size, startNumber: c.startNumber, count: c.count, cells };
  }
  return {
    format: BACKUP_FORMAT,
    version,
    schemaVersion: b.schemaVersion ?? (b.game as GameRecord).schemaVersion ?? 1,
    exportedAt: b.exportedAt ?? 0,
    game: migrateGame(b.game),
    generatorVersion: b.generatorVersion,
    setCode: b.setCode,
    cards: b.cards,
    images: b.images ?? {},
    snapshot,
    missingConfigKeys,
  };
}

export function backupFileName(g: GameRecord): string {
  const name = g.config.eventName.replace(/[^\p{L}\p{M}\p{N}]+/gu, '') || 'Bingo';
  const d = new Date(g.updatedAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const code = g.frozen ? '_' + g.frozen.setCode : '';
  return `${name}${code}_backup_${stamp}.json`;
}
