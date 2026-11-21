import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SetCodeBadge } from '../components/SetCode';
import { Modal, TopNav, useConfirm } from '../components/ui';
import { t } from '../i18n/th';
import { commitImport, prepareImport, type ImportPreview } from '../state/backupFile';
import { exportBackup } from '../state/backupIO';
import { createGame, deleteGame, dispatchTo, duplicateGame, getActiveId, loadGame, setActiveGame, useGameList } from '../state/gameStore';

function ImportDialog({ p, onClose, onDone }: { p: ImportPreview; onClose: () => void; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const g = p.game;
  const c = t.cardSet;
  const run = async (mode: 'replace' | 'keepBoth') => {
    setBusy(true);
    try {
      const res = await commitImport(p, mode);
      onDone(t.library.imported + ': ' + (res.label || res.config.eventName) + (p.setCode ? ` · ${c.code} ${p.setCode}` : ''));
    } catch (e) {
      onDone(String((e as Error).message));
    }
  };
  return (
    <Modal open onClose={onClose} title={c.importTitle} wide>
      {p.warnings.map((w) => <div key={w} className={`notice ${p.verified ? '' : 'warn'}`}>{w}</div>)}
      {p.selfCheckOk && <div className="dim small">✓ {c.selfCheckOk}</div>}
      {p.conflict && <div className="notice warn">{c.importConflict}</div>}
      <table className="import-table">
        <thead><tr><th /><th>{c.inFile}</th>{p.conflict && <th>{c.onThisMachine}</th>}</tr></thead>
        <tbody>
          <tr><th>{c.name}</th><td>{g.label || g.config.eventName}</td>{p.conflict && <td>{p.conflict.name}</td>}</tr>
          <tr><th>{c.code}</th><td>{p.setCode ? <SetCodeBadge code={p.setCode} verified={p.verified} /> : c.notGenerated}</td>{p.conflict && <td>{p.conflict.setCode ? <SetCodeBadge code={p.conflict.setCode} /> : c.notGenerated}</td>}</tr>
          <tr><th>{c.size}</th><td>{g.config.size}×{g.config.size}</td>{p.conflict && <td />}</tr>
          <tr><th>{c.cards}</th><td>{g.config.cardCount} {t.common.cards}</td>{p.conflict && <td />}</tr>
          <tr><th>{c.draws}</th><td>{g.draws.length}</td>{p.conflict && <td>{p.conflict.draws}</td>}</tr>
          <tr><th>{c.winners}</th><td>{g.winners.length}</td>{p.conflict && <td>{p.conflict.winners}</td>}</tr>
          <tr><th>{c.round}</th><td>{g.config.rounds[g.currentRound]?.name ?? '-'}</td>{p.conflict && <td />}</tr>
          <tr><th>{c.backupVersion}</th><td>{p.backupVersion}</td>{p.conflict && <td />}</tr>
        </tbody>
      </table>
      <div className="row end gap">
        <button className="btn" onClick={onClose} disabled={busy}>{t.common.cancel}</button>
        {p.conflict ? (
          <>
            <button className="btn" disabled={busy} onClick={() => run('keepBoth')}>{c.importKeepBoth}</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => run('replace')}>{c.importReplace}</button>
          </>
        ) : (
          <button className="btn btn-primary" autoFocus disabled={busy} onClick={() => run('replace')}>{c.importConfirm}</button>
        )}
      </div>
    </Modal>
  );
}

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

export function LibraryPage() {
  const games = useGameList();
  const nav = useNavigate();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const active = getActiveId();

  const openGame = (id: string, status: string) => {
    setActiveGame(id);
    nav(status === 'setup' ? '/setup' : status === 'ready' ? '/print' : '/control');
  };

  const onImport = async (f?: File) => {
    if (!f) return;
    try {
      setPreview(await prepareImport(await f.text()));
      setMsg(null);
    } catch (e) {
      setMsg(String((e as Error).message));
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="page">
      <TopNav />
      <main className="container">
        <section className="hero">
          <div>
            <h1 className="title-grad">{t.library.title}</h1>
            <p className="dim">{t.library.subtitle}</p>
          </div>
          <div className="row gap">
            <button className="btn btn-primary btn-lg" onClick={() => { createGame(); nav('/setup'); }}>
              {t.library.newGame}
            </button>
            <button className="btn btn-lg" onClick={() => fileRef.current?.click()}>{t.library.importBackup}</button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => onImport(e.target.files?.[0])} />
          </div>
        </section>
        {msg && <div className="notice">{msg}</div>}
        {games.length === 0 ? (
          <div className="empty panel">{t.library.empty}</div>
        ) : (
          <div className="game-list">
            {games.map((g) => (
              <div key={g.id} className={`panel game-row ${g.id === active ? 'active' : ''}`}>
                <div className="game-main" onClick={() => openGame(g.id, g.status)}>
                  <div className="game-name">{g.name}</div>
                  <div className="dim small">
                    {t.library.created} {fmtDate(g.createdAt)} · {t.library.size} {g.size}×{g.size} · {g.cardCount} {t.common.cards}
                  </div>
                  {g.setCode && <div className="small"><SetCodeBadge code={g.setCode} verified={g.verified} small /></div>}
                  {g.backupPending && (
                    <div className="small warn-text" onClick={(e) => e.stopPropagation()}>
                      {t.cardSet.backupPending}{' '}
                      <button className="btn btn-s" onClick={() => { const full = loadGame(g.id); if (full) exportBackup(full).catch((e) => setMsg(String(e.message))); }}>{t.cardSet.exportNew}</button>{' '}
                      <button className="btn btn-s" onClick={() => dispatchTo(g.id, { type: 'BACKUP_DONE' })}>{t.cardSet.dismiss}</button>
                    </div>
                  )}
                </div>
                <span className={`status-pill st-${g.status}`}>{t.library.statuses[g.status]}</span>
                <div className="row gap-s">
                  <button className="btn btn-primary" onClick={() => openGame(g.id, g.status)}>{t.common.open}</button>
                  {g.setCode && (g.status === 'playing' || g.status === 'finished') && (
                    <button className="btn" onClick={() => confirm.ask(t.cardSet.confirmRestart(g.name, g.setCode!), () => { dispatchTo(g.id, { type: 'RESTART_SAME_CARDS' }); setMsg(t.cardSet.restarted + ': ' + g.name); })}>↻ {t.cardSet.restart}</button>
                  )}
                  <button className="btn" onClick={() => { duplicateGame(g.id); nav('/setup'); }}>{t.library.duplicate}</button>
                  <button className="btn btn-danger" onClick={() => confirm.ask(t.library.confirmDelete(g.name), () => deleteGame(g.id))}>
                    {t.common.delete}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      {preview && <ImportDialog p={preview} onClose={() => setPreview(null)} onDone={(m) => { setPreview(null); setMsg(m); }} />}
      {confirm.node}
    </div>
  );
}
