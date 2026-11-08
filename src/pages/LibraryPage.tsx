import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopNav, useConfirm } from '../components/ui';
import { t } from '../i18n/th';
import { importBackupFile } from '../state/backupIO';
import { createGame, deleteGame, duplicateGame, getActiveId, setActiveGame, useGameList } from '../state/gameStore';

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

export function LibraryPage() {
  const games = useGameList();
  const nav = useNavigate();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const active = getActiveId();

  const openGame = (id: string, status: string) => {
    setActiveGame(id);
    nav(status === 'setup' ? '/setup' : status === 'ready' ? '/print' : '/control');
  };

  const onImport = async (f?: File) => {
    if (!f) return;
    try {
      const g = await importBackupFile(f);
      setMsg(t.library.imported + ': ' + g.config.eventName);
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
                </div>
                <span className={`status-pill st-${g.status}`}>{t.library.statuses[g.status]}</span>
                <div className="row gap-s">
                  <button className="btn btn-primary" onClick={() => openGame(g.id, g.status)}>{t.common.open}</button>
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
      {confirm.node}
    </div>
  );
}
