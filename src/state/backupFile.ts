// Backup export / import flows (no UI). Import = prepare (validate + preview) -> commit.
import { BACKUP_VERSION, collectImageRefs, createBackup, createBackupV2, parseBackup, serializeBackup, type ParsedBackup } from '../core/backup';
import { dataUrlToBytes, sha256, toHex } from '../core/bytes';
import {
  computeSetCode,
  encodeCards,
  generateCards,
  isFrozenRef,
  mapConfigImages,
  MISSING_PREFIX,
  SHA_PREFIX,
  snapshotsEqual,
  type CardSnapshot,
  type FrozenMeta,
} from '../core/frozen';
import type { GameRecord } from '../core/game';
import { newId } from '../core/rng';
import { buildFrozen, ensureCardSet, forgetCardSet } from './cardSet';
import { listGames, loadGame, saveImportedGame } from './gameStore';
import { blobToDataURL, getImageBlob, saveImageWithKey } from './images';
import { saveSnapshot } from './snapshotDb';

export const T_TAMPERED = 'ไฟล์ backup นี้เสียหายหรือถูกแก้ไข — รหัสชุดใบที่คำนวณได้ไม่ตรงกับที่บันทึกไว้ จึงไม่นำเข้า';
export const T_OLD_BACKUP =
  'ไฟล์ backup นี้เป็นรุ่นเก่า ใบในระบบอาจไม่ตรงกับใบที่พิมพ์ไว้ — กรุณา Export backup ใหม่จากเครื่องที่ใช้พิมพ์ใบ แล้ว import ไฟล์นั้นแทน';
export const IMPORTED_SUFFIX = ' (นำเข้า)';

/** Serialize the game (v2 with card snapshot when cards exist) */
export async function buildBackupText(g: GameRecord, now = Date.now()): Promise<string> {
  const images: Record<string, string> = {};
  if (!g.seed) {
    for (const key of collectImageRefs(g)) {
      const blob = await getImageBlob('idb:' + key);
      if (blob) images[key] = await blobToDataURL(blob);
    }
    return serializeBackup(createBackup(g, images, now));
  }
  const set = await ensureCardSet(g);
  const fresh = loadGame(g.id) ?? g; // ensureCardSet may have just migrated it
  if (!set || !fresh.frozen) throw new Error('โหลดข้อมูลใบไม่สำเร็จ จึงยังสำรองไม่ได้');
  for (const key of collectImageRefs(fresh)) {
    const blob = await getImageBlob('idb:' + key);
    if (!blob) throw new Error('รูปที่ใช้ในใบหายไปจากเครื่องนี้ จึงสำรองให้ครบไม่ได้ (' + key.slice(0, 16) + '…)');
    images[key] = await blobToDataURL(blob);
  }
  return serializeBackup(createBackupV2(fresh, set.snap, images, now));
}

export type ImportPreview = {
  backupVersion: number;
  game: GameRecord;
  snapshot: CardSnapshot | null;
  /** sha key -> bytes to store */
  images: Map<string, { bytes: Uint8Array; mime: string }>;
  setCode: string | null;
  verified: boolean;
  warnings: string[];
  /** regenerating from the seed with the recorded generator gave the same cards */
  selfCheckOk: boolean | null;
  conflict: { name: string; setCode: string | null; draws: number; winners: number; updatedAt: number } | null;
};

async function hashKey(bytes: Uint8Array) {
  return SHA_PREFIX + toHex(await sha256(bytes));
}

async function prepareV2(b: ParsedBackup): Promise<Omit<ImportPreview, 'conflict'>> {
  const g = b.game;
  const snap = b.snapshot!;
  const fz = g.frozen!;
  if (!g.seed) throw new Error(T_TAMPERED);
  if (fz.setCode !== b.setCode || fz.generatorVersion !== b.generatorVersion) throw new Error(T_TAMPERED);
  if (snap.size !== g.config.size || snap.startNumber !== g.config.startNumber || snap.count !== g.config.cardCount) throw new Error(T_TAMPERED);
  // images: each must match its content hash, and every image the cards use must be present
  const images = new Map<string, { bytes: Uint8Array; mime: string }>();
  for (const [key, data] of Object.entries(b.images)) {
    const { bytes, mime } = dataUrlToBytes(data);
    if ((await hashKey(bytes)) !== key) throw new Error(T_TAMPERED);
    images.set(key, { bytes, mime });
  }
  for (const ref of [g.config.eventLogo, ...g.config.columns.map((c) => c.image), ...g.config.items.map((c) => c.image)]) {
    if (!isFrozenRef(ref)) throw new Error(T_TAMPERED);
    if (ref?.startsWith('idb:') && !images.has(ref.slice(4))) throw new Error('ไฟล์ backup ไม่มีรูปที่ใช้ในใบครบ — ไฟล์อาจเสียหาย');
  }
  if ((await computeSetCode(fz.generatorVersion, g.seed, g.config, snap)) !== fz.setCode) throw new Error(T_TAMPERED);
  const regen = encodeCards(fz.generatorVersion, g.config.size, g.config.startNumber, generateCards(fz.generatorVersion, g.config, g.seed, g.attempts));
  const selfCheckOk = snapshotsEqual(regen, snap);
  const warnings = selfCheckOk ? [] : ['การสร้างใบซ้ำจาก seed ให้ผลไม่ตรงกับข้อมูลใบในไฟล์ — ใช้ข้อมูลใบจากไฟล์ (ตรงกับใบที่พิมพ์)'];
  // a v2 file already is a new-format backup: no need to ask for another export
  const game: GameRecord = { ...g, frozen: { ...fz, backupPending: false } };
  return { backupVersion: b.version, game, snapshot: snap, images, setCode: fz.setCode, verified: fz.verified, warnings, selfCheckOk };
}

async function prepareV1(b: ParsedBackup): Promise<Omit<ImportPreview, 'conflict'>> {
  const images = new Map<string, { bytes: Uint8Array; mime: string }>();
  const rekey = new Map<string, string>();
  for (const [key, data] of Object.entries(b.images)) {
    const { bytes, mime } = dataUrlToBytes(data);
    const k = await hashKey(bytes);
    images.set(k, { bytes, mime });
    rekey.set('idb:' + key, 'idb:' + k);
  }
  const g = b.game;
  if (!g.seed) return { backupVersion: b.version, game: { ...g, frozen: null }, snapshot: null, images, setCode: null, verified: true, warnings: [], selfCheckOk: null };

  // What a v1 file can and cannot guarantee: the cells and check codes are rebuilt exactly
  // (the v1 generator is deterministic), but images from the app's own folder are not inside it.
  const reasons: string[] = [];
  const bundled = new Set<string>();
  const cfg = mapConfigImages(g.config, (ref) => {
    if (rekey.has(ref)) return rekey.get(ref)!;
    if (ref.startsWith('idb:')) {
      reasons.push('รูปบางรูปไม่อยู่ในไฟล์ backup');
      return MISSING_PREFIX + ref;
    }
    bundled.add(ref);
    return ref; // frozen below from THIS machine's files
  });
  if (bundled.size) reasons.push('รูปจากโฟลเดอร์ของแอปไม่อยู่ในไฟล์ backup: ' + [...bundled].join(', '));
  if (b.missingConfigKeys.includes('eventLogo')) reasons.push('ไฟล์ไม่ได้ระบุโลโก้งาน (อาจถูกลบออกก่อนพิมพ์)');
  const built = await buildFrozen(1, g.seed, g.attempts, cfg);
  const verified = reasons.length === 0;
  const frozen: FrozenMeta = { generatorVersion: 1, setCode: built.setCode, origin: 'imported', verified, unverifiedReasons: verified ? undefined : reasons, backupPending: true };
  return {
    backupVersion: b.version,
    game: { ...g, config: built.config, frozen },
    snapshot: built.snap,
    images,
    setCode: built.setCode,
    verified,
    warnings: verified ? [] : [T_OLD_BACKUP, ...reasons],
    selfCheckOk: null,
  };
}

/** Validate a backup file and describe what importing it would do. Throws (Thai message) on bad files. */
export async function prepareImport(text: string): Promise<ImportPreview> {
  const b = parseBackup(text);
  const p = b.version >= 2 ? await prepareV2(b) : await prepareV1(b);
  const existing = listGames().some((m) => m.id === p.game.id) ? loadGame(p.game.id) : null;
  return {
    ...p,
    conflict: existing
      ? { name: existing.label || existing.config.eventName, setCode: existing.frozen?.setCode ?? null, draws: existing.draws.length, winners: existing.winners.length, updatedAt: existing.updatedAt }
      : null,
  };
}

/** Store the images and the snapshot, then the game. `keepBoth` = new local id, same cards and set code. */
export async function commitImport(p: ImportPreview, mode: 'replace' | 'keepBoth' = 'replace'): Promise<GameRecord> {
  for (const [key, img] of p.images) await saveImageWithKey(key, new Blob([img.bytes], { type: img.mime }));
  const keepBoth = mode === 'keepBoth' && !!p.conflict;
  const id = keepBoth ? newId('g') : p.game.id;
  const now = Date.now();
  const note =
    `นำเข้าจาก backup รุ่น ${p.backupVersion}` +
    (p.setCode ? ` ชุดใบ ${p.setCode}` : '') +
    (p.conflict ? (keepBoth ? ' (เก็บไว้ทั้งสองเกม)' : ' (แทนที่เกมเดิม)') : '');
  const log = [...p.game.log, { t: now, type: 'import', detail: note }, ...p.warnings.map((w) => ({ t: now, type: 'warning', detail: w }))];
  const g: GameRecord = {
    ...p.game,
    id,
    label: keepBoth ? (p.game.label || p.game.config.eventName) + IMPORTED_SUFFIX : p.game.label,
    log,
    updatedAt: now,
  };
  if (p.snapshot) await saveSnapshot(id, p.snapshot);
  forgetCardSet(id);
  return saveImportedGame(g);
}

export { BACKUP_VERSION };
