import { backupFileName, collectImageRefs, createBackup, parseBackup, serializeBackup } from '../core/backup';
import type { GameRecord } from '../core/game';
import { downloadText } from '../components/ui';
import { importGame } from './gameStore';
import { blobToDataURL, dataURLToBlob, getImageBlob, saveImageWithKey } from './images';

export async function exportBackup(g: GameRecord) {
  const images: Record<string, string> = {};
  for (const key of collectImageRefs(g)) {
    const blob = await getImageBlob('idb:' + key);
    if (blob) images[key] = await blobToDataURL(blob);
  }
  downloadText(backupFileName(g), serializeBackup(createBackup(g, images, Date.now())));
}

export async function importBackupFile(file: File): Promise<GameRecord> {
  const b = parseBackup(await file.text());
  for (const [key, data] of Object.entries(b.images)) {
    await saveImageWithKey(key, await dataURLToBlob(data));
  }
  return importGame(b.game, true);
}
