// Backup (de)serialization – pure. Image bytes are passed in/out as data URLs.
import { migrateGame, type GameRecord } from './game';

export const BACKUP_FORMAT = 'newyear-bingo-backup';
export const BACKUP_VERSION = 1;

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  game: GameRecord;
  /** idb key -> data URL */
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

export function createBackup(g: GameRecord, images: Record<string, string>, now: number): BackupFile {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now, game: g, images };
}

export function serializeBackup(b: BackupFile): string {
  return JSON.stringify(b);
}

export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('ไฟล์ไม่ใช่ JSON ที่ถูกต้อง');
  }
  const b = raw as Partial<BackupFile>;
  if (!b || b.format !== BACKUP_FORMAT) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของเกมบิงโก');
  if (!b.game) throw new Error('ไฟล์สำรองไม่มีข้อมูลเกม');
  return {
    format: BACKUP_FORMAT,
    version: b.version ?? 1,
    exportedAt: b.exportedAt ?? 0,
    game: migrateGame(b.game),
    images: b.images ?? {},
  };
}

export function backupFileName(g: GameRecord): string {
  const name = g.config.eventName.replace(/[^\p{L}\p{M}\p{N}]+/gu, '') || 'Bingo';
  const d = new Date(g.updatedAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `${name}_backup_${stamp}.json`;
}
