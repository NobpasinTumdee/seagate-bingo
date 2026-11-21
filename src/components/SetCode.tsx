import { useState } from 'react';
import type { GameRecord } from '../core/game';
import { t } from '../i18n/th';
import { exportBackup } from '../state/backupIO';
import { dispatchTo } from '../state/gameStore';

/** "ชุดใบ XXXX-XXXX" + verified / unverified badge */
export function SetCodeBadge({ code, verified, small = false }: { code?: string; verified?: boolean; small?: boolean }) {
  if (!code) return null;
  return (
    <span className={`setcode ${small ? 'setcode-s' : ''}`}>
      <span className="setcode-label">{t.cardSet.code}</span> <b className="setcode-val">{code}</b>
      {verified !== undefined && (
        <span className={`vbadge ${verified ? 'ok' : 'warn'}`} title={verified ? t.cardSet.verifiedTip : t.cardSet.unverifiedTip}>
          {verified ? '✓ ' + t.cardSet.verified : '⚠ ' + t.cardSet.unverified}
        </span>
      )}
    </span>
  );
}

/** Set code with hint, unverified warning and the one-time "export a new backup" prompt */
export function SetCodeLine({ game, error, hint = true }: { game: GameRecord; error?: string | null; hint?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fz = game.frozen;
  if (error) return <div className="notice bad">{error}</div>;
  if (!fz) return <div className="dim small">{t.cardSet.loading}</div>;
  return (
    <div className="setcode-line">
      <div className="row gap-s wrap">
        <SetCodeBadge code={fz.setCode} verified={fz.verified} />
        {hint && <span className="dim small">{t.cardSet.codeHint}</span>}
      </div>
      {!fz.verified && (
        <div className="notice warn small">
          {t.cardSet.unverifiedTip}
          {fz.unverifiedReasons?.map((r) => <div key={r}>• {r}</div>)}
        </div>
      )}
      {fz.backupPending && (
        <div className="notice small row between wrap gap-s">
          <span>{t.cardSet.backupPending}</span>
          <span className="row gap-s">
            <button className="btn btn-s btn-primary" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await exportBackup(game); } catch (e) { setMsg(String((e as Error).message)); } finally { setBusy(false); }
            }}>{t.cardSet.exportNew}</button>
            <button className="btn btn-s" onClick={() => dispatchTo(game.id, { type: 'BACKUP_DONE' })}>{t.cardSet.dismiss}</button>
          </span>
        </div>
      )}
      {msg && <div className="notice bad small">{msg}</div>}
    </div>
  );
}
