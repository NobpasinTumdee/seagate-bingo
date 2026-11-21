import { backupFileName } from '../core/backup';
import type { GameRecord } from '../core/game';
import { downloadText } from '../components/ui';
import { buildBackupText } from './backupFile';
import { dispatchTo, loadGame } from './gameStore';

/** Download a backup file; clears the "please export a new backup" prompt */
export async function exportBackup(g: GameRecord): Promise<void> {
  let text: string;
  try {
    text = await buildBackupText(g);
  } catch (e) {
    window.alert(String((e as Error).message));
    return;
  }
  const fresh = loadGame(g.id) ?? g;
  downloadText(backupFileName(fresh), text);
  if (fresh.frozen?.backupPending) dispatchTo(g.id, { type: 'BACKUP_DONE' });
}
