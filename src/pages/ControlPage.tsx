import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { checkCode, formatCardNo } from '../core/cards';
import { canDraw, remainingBalls } from '../core/game';
import { maskCells } from '../core/patterns';
import { secureRandomInt } from '../core/rng';
import { ballLabel } from '../core/symbols';
import { checkCard, parseCardInput, type CheckResult } from '../core/verify';
import { Ball } from '../components/Ball';
import { CardView } from '../components/CardView';
import { Stage } from '../components/stage/Stage';
import { hasThaiVoice, unlockAudio } from '../components/stage/audio';
import { Modal, NoGame, PatternGrid, useConfirm } from '../components/ui';
import { t } from '../i18n/th';
import { exportBackup } from '../state/backupIO';
import { getEngine } from '../state/engine';
import { dispatch, useGame } from '../state/gameStore';
import { animTiming, buildPublicState, prefersReducedMotion, type LiveState, type PublicCard } from '../state/publicState';
import { createHost } from '../state/sync';
import { THEMES } from '../themes';

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export default function ControlPage() {
  const game = useGame();
  const engine = useMemo(() => getEngine(game), [game]);
  const [live, setLive] = useState<LiveState>({ reveal: null, showCard: null, rulesOpen: false });
  const [animating, setAnimating] = useState(false);
  const [presenter, setPresenter] = useState(false);
  const [barOpen, setBarOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [checkInput, setCheckInput] = useState('');
  const [checked, setChecked] = useState<{ no: number; code: string } | null>(null);
  const checkRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const animTimer = useRef<number>(0);
  const [thaiVoice, setThaiVoice] = useState(true);

  const ps = useMemo(() => (game ? buildPublicState(game, engine, live) : null), [game, engine, live]);
  const psRef = useRef(ps);
  psRef.current = ps;
  const hostRef = useRef<ReturnType<typeof createHost> | null>(null);

  useEffect(() => {
    hostRef.current = createHost(() => psRef.current);
    return () => hostRef.current?.close();
  }, []);
  useEffect(() => {
    if (ps) hostRef.current?.publish(ps);
  }, [ps]);

  useEffect(() => {
    const check = () => setThaiVoice(hasThaiVoice());
    check();
    const tm = setTimeout(check, 1500);
    return () => clearTimeout(tm);
  }, []);

  // warn before closing the tab mid-game
  useEffect(() => {
    if (game?.status !== 'playing') return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [game?.status]);

  const g = game;
  const cfg = g?.config;
  const drawState = g ? canDraw(g) : { ok: false };
  const total = cfg ? cfg.poolMax - cfg.poolMin + 1 : 0;
  const round = cfg?.rounds[g!.currentRound];
  const nextRound = cfg?.rounds[g!.currentRound + 1];
  const roundWinners = g ? g.winners.filter((w) => w.round === g.currentRound) : [];
  const roundComplete = !!round && roundWinners.length >= round.winnersWanted;
  const pending = roundWinners.filter((w) => !w.revealed);
  const alertList = animating ? [] : pending.filter((w) => !dismissed.has(`${w.round}:${w.cardNo}`));
  const away = useMemo(() => (g && engine ? engine.evaluate(g.draws, g.currentRound, g.winners) : null), [g, engine]);

  const draw = useCallback(() => {
    const cur = game;
    if (!cur || !engine || animating) return;
    if (!canDraw(cur).ok) return;
    unlockAudio();
    const rem = remainingBalls(cur);
    const ball = rem[secureRandomInt(rem.length)];
    const res = engine.evaluate([...cur.draws, ball], cur.currentRound, cur.winners);
    setLive((l) => ({ ...l, showCard: null, reveal: null }));
    dispatch({ type: 'DRAW', ball, winners: res.newWinners });
    setAnimating(true);
    clearTimeout(animTimer.current);
    animTimer.current = window.setTimeout(() => setAnimating(false), animTiming(cur.settings.speed, prefersReducedMotion()).total);
  }, [game, engine, animating]);

  const undo = useCallback(() => {
    if (!game || game.draws.length === 0 || animating) return;
    const last = game.draws[game.draws.length - 1];
    confirm.ask(t.control.confirmUndo(ballLabel(game.config, last)), () => {
      dispatch({ type: 'UNDO' });
      setLive((l) => ({ ...l, reveal: null, showCard: null }));
    });
  }, [game, animating, confirm]);

  const goNextRound = useCallback(() => {
    if (!game || !engine || !nextRound) return;
    const run = () => {
      const res = engine.evaluate(game.draws, game.currentRound + 1, game.winners);
      dispatch({ type: 'NEXT_ROUND', winners: res.newWinners });
      setLive((l) => ({ ...l, reveal: null, showCard: null }));
    };
    if (!roundComplete) confirm.ask(t.control.confirmNextRound, run);
    else run();
  }, [game, engine, nextRound, roundComplete, confirm]);

  const publicCard = (no: number, r: number): PublicCard | null => {
    if (!engine || !game) return null;
    const st = engine.cardStatus(no, game.draws, r);
    if (!st.card) return null;
    return { no, cells: st.card.cells, win: st.mask ? maskCells(st.mask) : [] };
  };

  const reveal = useCallback(
    (cardNos: number[]) => {
      if (!game || cardNos.length === 0) return;
      const r = game.currentRound;
      const cards = cardNos.map((no) => publicCard(no, r)).filter((c): c is PublicCard => !!c);
      setLive((l) => ({ ...l, showCard: null, reveal: { seq: Date.now(), round: r, roundName: game.config.rounds[r].name, prize: game.config.rounds[r].prize, cards } }));
      dispatch({ type: 'REVEAL', round: r, cardNos });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game, engine],
  );

  const togglePause = useCallback(() => game && dispatch({ type: 'SET_PAUSED', paused: !game.paused }), [game]);

  // keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (confirm.open) return;
      if (isTyping(e)) return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        draw();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey || e.metaKey || e.altKey) return;
      else if (e.key === 'p' || e.key === 'P') togglePause();
      else if (e.key === 'n' || e.key === 'N') goNextRound();
      else if (e.key === 'r' || e.key === 'R') reveal(pending.map((w) => w.cardNo));
      else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        if (presenter) setBarOpen(true);
        setTimeout(() => checkRef.current?.focus(), 50);
      } else if (e.key === 'h' || e.key === 'H') setBarOpen((b) => !b);
      else if (e.key === 'm' || e.key === 'M') game && dispatch({ type: 'SET_SETTINGS', patch: { sound: !game.settings.sound } });
      else if (e.key === '?') setHelpOpen(true);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [draw, undo, togglePause, goNextRound, reveal, pending, presenter, game, confirm.open]);

  const checkResult: CheckResult | null = useMemo(() => {
    if (!checked || !game || !engine) return null;
    return checkCard(game, engine, checked.no, checked.code);
  }, [checked, game, engine]);

  if (!game || !cfg) return <NoGame />;
  if (!game.seed || !engine) {
    return (
      <div className="page center-page">
        <div className="notice warn">{t.print.notGenerated}</div>
        <Link className="btn btn-primary" to="/setup">{t.nav.setup}</Link>
      </div>
    );
  }

  const latest = game.draws[game.draws.length - 1];
  const drawnSet = new Set(game.draws);
  const settings = game.settings;
  const setS = (patch: Partial<typeof settings>) => dispatch({ type: 'SET_SETTINGS', patch });
  const drawDisabled = !drawState.ok || animating;
  const drawLabel = animating ? t.control.drawing : game.status === 'finished' ? t.control.finished : game.paused ? t.control.paused : game.draws.length >= total ? t.control.noBalls : t.control.draw;

  const statusText = (r: CheckResult) => {
    switch (r.status) {
      case 'win': return t.control.statusWin;
      case 'pending': return t.control.statusPending(r.missing ?? 0);
      case 'forged': return t.control.statusForged;
      case 'wonEarlier': return t.control.statusEarlier(cfg.rounds[r.earlierRound ?? 0]?.name ?? '');
      default: return t.control.statusNotFound;
    }
  };

  const showOnScreen = (r: CheckResult) => {
    if (!r.card) return;
    // showing an unrevealed winner IS revealing it: go through the reveal sequence (and mark it revealed)
    if (pending.some((w) => w.cardNo === r.cardNo)) {
      reveal([r.cardNo]);
      return;
    }
    const pc = publicCard(r.cardNo, game.currentRound);
    if (!pc) return;
    setLive((l) => ({ ...l, showCard: { seq: Date.now(), card: pc, status: `${t.display.card} ${formatCardNo(r.cardNo)} — ${statusText(r)}`, ok: r.status === 'win' } }));
  };

  const winnersAlert = alertList.length > 0 && (
    <div className="winners-alert">
      <div className="winners-alert-text">{t.control.winnersFound(alertList.length, alertList.map((w) => formatCardNo(w.cardNo)).join(', '))}</div>
      <div className="row gap-s">
        <button className="btn btn-primary btn-lg" onClick={() => reveal(pending.map((w) => w.cardNo))}>{t.control.reveal}</button>
        <button className="btn btn-lg" onClick={() => setDismissed(new Set([...dismissed, ...alertList.map((w) => `${w.round}:${w.cardNo}`)]))}>{t.control.notYet}</button>
      </div>
    </div>
  );

  const coreButtons = (
    <>
      <button className="btn btn-primary draw-btn" disabled={drawDisabled} onClick={draw} title="Space">
        {drawLabel}
      </button>
      <div className="row gap-s">
        <button className="btn grow" disabled={game.draws.length === 0 || animating || game.status === 'finished'} onClick={undo} title="Ctrl+Z">↶ {t.control.undo}</button>
        <button className={`btn grow ${game.paused ? 'on' : ''}`} onClick={togglePause} title="P">{game.paused ? '▶ ' + t.control.resume : '❚❚ ' + t.control.pause}</button>
      </div>
    </>
  );

  const toolbar = (
    <div className="ctl-toolbar">
      <Link to="/" className="brand"><span className="brand-ball">B</span></Link>
      <button className="btn btn-s" onClick={() => window.open('/display', 'bingo-display', 'popup,width=1280,height=720')}>{t.control.openTv}</button>
      <button className="btn btn-s" onClick={() => { setPresenter(true); setBarOpen(false); }}>{t.control.presenter}</button>
      <button className={`btn btn-s ${live.rulesOpen ? 'on' : ''}`} onClick={() => setLive((l) => ({ ...l, rulesOpen: !l.rulesOpen }))}>{live.rulesOpen ? t.control.hideRules : t.control.rulesOnTv}</button>
      <span className="sep" />
      <button className={`btn btn-s ${settings.sound ? 'on' : ''}`} onClick={() => setS({ sound: !settings.sound })} title="M">{settings.sound ? '🔊' : '🔇'} {t.control.sound}</button>
      <input className="vol" type="range" min={0} max={1} step={0.05} value={settings.volume} onChange={(e) => setS({ volume: parseFloat(e.target.value) })} aria-label={t.control.volume} />
      <button className={`btn btn-s ${settings.voice && thaiVoice ? 'on' : ''}`} disabled={!thaiVoice} title={thaiVoice ? '' : t.control.noVoice} onClick={() => setS({ voice: !settings.voice })}>🗣 {t.control.voice}</button>
      <select value={settings.speed} onChange={(e) => setS({ speed: e.target.value as typeof settings.speed })} aria-label={t.control.speed}>
        {(['fast', 'normal', 'max'] as const).map((s) => <option key={s} value={s}>{t.control.speeds[s]}</option>)}
      </select>
      <select value={settings.themeId} onChange={(e) => setS({ themeId: e.target.value })} aria-label={t.control.theme}>
        {THEMES.map((th) => <option key={th.id} value={th.id}>{th.name}</option>)}
      </select>
      <span className="grow" />
      <button className="btn btn-s" onClick={() => exportBackup(game)}>{t.control.exportBackup}</button>
      <button className="btn btn-s" onClick={() => setLogOpen(true)}>{t.control.log}</button>
      <button className="btn btn-s btn-danger" disabled={game.status === 'finished'} onClick={() => confirm.ask(t.control.confirmEnd, () => dispatch({ type: 'END_GAME' }))}>{t.control.endGame}</button>
      <button className="btn btn-s" onClick={() => setHelpOpen(true)} title="?">?</button>
    </div>
  );

  const checker = (
    <div className="panel ctl-checker">
      <h3>{t.control.checker}</h3>
      <form
        className="row gap-s"
        onSubmit={(e) => {
          e.preventDefault();
          const p = parseCardInput(checkInput);
          setChecked(p.no === null ? { no: -1, code: '' } : { no: p.no, code: p.code });
        }}
      >
        <input ref={checkRef} className="grow" placeholder={t.control.checkerPlaceholder} value={checkInput} onChange={(e) => setCheckInput(e.target.value)} />
        <button className="btn btn-primary" type="submit">{t.control.check}</button>
      </form>
      {checkResult && (
        <div className={`check-result st-${checkResult.status}`}>
          <div className="check-status">{statusText(checkResult)}</div>
          {checkResult.codeOk === undefined && checkResult.card && checkResult.status !== 'forged' && <div className="dim small">{t.control.noCode} ({t.display.card} {formatCardNo(checkResult.cardNo)}: {checkCode(game.seed, checkResult.cardNo)})</div>}
          {checkResult.card && (
            <>
              <div className="check-card">
                <CardView cfg={cfg} card={checkResult.card} code={checkCode(game.seed, checkResult.cardNo)} drawn={drawnSet} highlight={checkResult.winCells} showMeta={false} />
              </div>
              <div className="row gap-s wrap">
                {live.showCard?.card.no === checkResult.cardNo ? (
                  <button className="btn" onClick={() => setLive((l) => ({ ...l, showCard: null }))}>{t.control.hideFromScreen}</button>
                ) : (
                  <button className="btn" onClick={() => showOnScreen(checkResult)}>{t.control.showOnScreen}</button>
                )}
                {checkResult.status === 'win' && !roundWinners.some((w) => w.cardNo === checkResult.cardNo) && (
                  <button className="btn btn-primary" onClick={() => dispatch({ type: 'ADD_WINNERS', winners: [checkResult.cardNo] })}>{t.control.addAsWinner}</button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );

  if (presenter) {
    return (
      <div className="presenter">
        <Stage ps={ps} interactive={false} />
        {!barOpen && (
          <button className="presenter-handle" onClick={() => setBarOpen(true)} title="H">☰</button>
        )}
        {barOpen && (
          <div className="presenter-bar">
            <div className="presenter-bar-main">
              <div className="col gap-s pb-draw">{coreButtons}</div>
              <div className="col gap-s">
                <div><b>{round?.name}</b> · {t.control.drawnCount(game.draws.length, total)}</div>
                <div className="row gap-s wrap">
                  <button className="btn" disabled={!nextRound} onClick={goNextRound}>{t.control.nextRound}</button>
                  {live.reveal && <button className="btn" onClick={() => setLive((l) => ({ ...l, reveal: null }))}>{t.control.closeReveal}</button>}
                  {live.showCard && <button className="btn" onClick={() => setLive((l) => ({ ...l, showCard: null }))}>{t.control.hideFromScreen}</button>}
                  <button className="btn" onClick={() => setLive((l) => ({ ...l, rulesOpen: !l.rulesOpen }))}>{t.control.rules}</button>
                </div>
                {winnersAlert}
                {pending.length > 0 && alertList.length === 0 && (
                  <button className="btn btn-primary" onClick={() => reveal(pending.map((w) => w.cardNo))}>{t.control.reveal} ({pending.map((w) => formatCardNo(w.cardNo)).join(', ')})</button>
                )}
              </div>
              <div className="pb-checker">{checker}</div>
            </div>
            <div className="row gap-s end">
              <button className="btn btn-s" onClick={() => setBarOpen(false)}>{t.control.hideBar}</button>
              <button className="btn btn-s" onClick={() => setPresenter(false)}>{t.control.exitPresenter}</button>
            </div>
          </div>
        )}
        {confirm.node}
      </div>
    );
  }

  return (
    <div className="control">
      {toolbar}
      <main className="ctl-main">
        <section className="panel ctl-draw">
          {coreButtons}
          <div className="ctl-latest">
            {latest !== undefined ? <Ball cfg={cfg} value={latest} size={168} pulse={!animating} /> : <div className="ctl-latest-empty">{t.display.waitingFirst}</div>}
            <div>
              <div className="dim small">{t.control.latest}</div>
              <div className="ctl-latest-label">{latest !== undefined ? ballLabel(cfg, latest) : '—'}</div>
              <div className="ctl-count">{t.control.drawnCount(game.draws.length, total)}</div>
            </div>
          </div>
          <div className="row between">
            <span className="dim small">{t.control.history}</span>
            <button className="btn btn-s" onClick={() => setHistoryOpen(true)}>{t.control.showAll}</button>
          </div>
          <div className="ctl-history">
            {game.draws.slice(-24).reverse().map((v, i) => (
              <Ball key={v} cfg={cfg} value={v} size={i === 0 ? 54 : 46} />
            ))}
          </div>
        </section>

        <section className="ctl-mid">
          <div className="panel ctl-round">
            <div className="ctl-round-main">
              <div>
                <div className="dim small">{t.control.round} ({game.currentRound + 1}/{cfg.rounds.length})</div>
                <div className="ctl-round-name">{round?.name}</div>
                <div className="ctl-prize">🏆 {round?.prize || '—'} · {roundWinners.length}/{round?.winnersWanted} {t.common.cards}</div>
                {ps && <div className="dim small">{ps.rounds[game.currentRound]?.patternName}</div>}
              </div>
              {ps && <PatternGrid size={cfg.size} cells={ps.rounds[game.currentRound]?.cells ?? []} className="ctl-pgrid" />}
            </div>
            <div className="row between gap-s">
              <span className="dim small">{t.control.nextRoundLabel}: {nextRound ? nextRound.name : t.control.lastRound}</span>
              <button className={`btn ${roundComplete ? 'btn-primary' : ''}`} disabled={!nextRound} onClick={goNextRound} title="N">{t.control.nextRound}</button>
            </div>
            {roundComplete && <div className="notice">{t.control.roundComplete}</div>}
          </div>

          {winnersAlert}

          <div className="panel ctl-winners">
            <h3>{t.control.winners}</h3>
            {cfg.rounds.map((r, i) => {
              const ws = game.winners.filter((w) => w.round === i);
              return (
                <div key={r.id} className={`ctl-wround ${i === game.currentRound ? 'cur' : ''}`}>
                  <span className="ctl-wround-name">{r.name}</span>
                  <span className="ctl-wcards">
                    {ws.length === 0 ? <span className="dim">—</span> : ws.map((w) => (
                      <button key={w.cardNo} className={`wchip ${w.revealed ? 'revealed' : ''}`} title={w.revealed ? t.control.revealed : ''} onClick={() => { setCheckInput(String(w.cardNo)); setChecked({ no: w.cardNo, code: checkCode(game.seed!, w.cardNo) }); }}>
                        {formatCardNo(w.cardNo)} <small>{t.common.draw} {w.atDraw}</small>
                      </button>
                    ))}
                  </span>
                </div>
              );
            })}
            <div className="row gap-s wrap">
              {pending.length > 0 && <button className="btn btn-primary" onClick={() => reveal(pending.map((w) => w.cardNo))} title="R">{t.control.reveal} ({pending.length})</button>}
              {live.reveal && <button className="btn" onClick={() => setLive((l) => ({ ...l, reveal: null }))}>{t.control.closeReveal}</button>}
            </div>
          </div>

          <div className="panel ctl-suspense">
            <h3>{t.control.suspense}</h3>
            <div className="row gap">
              <div className="stat"><b>{roundComplete ? 0 : away?.oneAway ?? 0}</b><span>{t.control.oneAway}</span></div>
              <div className="stat"><b>{roundComplete ? 0 : away?.twoAway ?? 0}</b><span>{t.control.twoAway}</span></div>
            </div>
          </div>
        </section>

        <section className="ctl-right">{checker}</section>
      </main>

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title={`${t.control.history} — ${t.control.drawnCount(game.draws.length, total)}`} wide>
        <div className="history-all">
          {game.draws.map((v, i) => (
            <div key={v} className="history-item"><span className="dim small">{i + 1}</span><Ball cfg={cfg} value={v} size={58} /></div>
          ))}
        </div>
      </Modal>
      <Modal open={logOpen} onClose={() => setLogOpen(false)} title={t.control.log} wide>
        <table className="log-table">
          <tbody>
            {game.log.slice().reverse().map((l, i) => (
              <tr key={i}><td className="dim">{new Date(l.t).toLocaleTimeString('th-TH')}</td><td>{l.type}</td><td>{l.detail}</td></tr>
            ))}
          </tbody>
        </table>
      </Modal>
      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title={t.control.shortcuts}>
        <table className="keys-table">
          <tbody>
            {t.control.keys.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}
          </tbody>
        </table>
      </Modal>
      {confirm.node}
    </div>
  );
}
