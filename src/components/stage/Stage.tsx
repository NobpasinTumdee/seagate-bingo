import confetti from 'canvas-confetti';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatCardNo } from '../../core/cards';
import { t } from '../../i18n/th';
import { animTiming, prefersReducedMotion, revealTiming, type PublicState, type RevealPayload } from '../../state/publicState';
import { Ball, BallFace } from '../Ball';
import { CardView } from '../CardView';
import { SymbolView } from '../SymbolView';
import { PatternGrid } from '../ui';
import { getTheme } from '../../themes';
import { ding, drumRoll, fanfare, chime, setAudio, speak, spinTicks, whoosh } from './audio';
import { boardLayout } from './boardLayout';

export const STAGE_W = 1920;
export const STAGE_H = 1080;
const BALL_SIZE = 470;
const BALL_CX = 350;
const BALL_CY = 178 + BALL_SIZE / 2;
const BOARD = { x: 700, y: 178, w: 1180, h: 690 };

/** Fixed 1920×1080 stage scaled to fit the viewport with letterboxing */
export function ScaledStage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <div className="stage-viewport">
      <div className="stage" style={{ width: STAGE_W, height: STAGE_H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

function sameArr(a: number[], b: number[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function Decor({ kind }: { kind: string }) {
  if (kind === 'deco')
    return (
      <div className="decor decor-deco" aria-hidden>
        <svg className="deco-frame" viewBox="0 0 1920 1080" preserveAspectRatio="none">
          <rect x="18" y="18" width="1884" height="1044" fill="none" stroke="url(#dg)" strokeWidth="2" />
          <rect x="30" y="30" width="1860" height="1020" fill="none" stroke="rgba(212,175,55,.35)" strokeWidth="1" />
          <defs>
            <linearGradient id="dg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff0b8" /><stop offset=".3" stopColor="#c9982f" /><stop offset=".6" stopColor="#f3d77a" /><stop offset="1" stopColor="#8c6418" />
            </linearGradient>
          </defs>
          {[[18, 18, 1, 1], [1902, 18, -1, 1], [18, 1062, 1, -1], [1902, 1062, -1, -1]].map(([x, y, sx, sy], i) => (
            <g key={i} transform={`translate(${x} ${y}) scale(${sx} ${sy})`} stroke="url(#dg)" fill="none" strokeWidth="2">
              <path d="M0 90 L0 0 L90 0" strokeWidth="4" />
              <path d="M22 70 L22 22 L70 22" />
              <path d="M36 36 L60 36 M36 36 L36 60" />
              <circle cx="22" cy="22" r="5" fill="#e6c063" />
              <path d="M90 0 L110 12 L130 0" />
              <path d="M0 90 L12 110 L0 130" />
            </g>
          ))}
        </svg>
        <div className="sparkles">
          {Array.from({ length: 26 }, (_, i) => (
            <span key={i} style={{ left: `${(i * 37.7) % 100}%`, top: `${(i * 53.3) % 100}%`, animationDelay: `${(i * 0.73) % 6}s`, animationDuration: `${4 + (i % 5)}s` }} />
          ))}
        </div>
      </div>
    );
  return (
    <div className="decor decor-circuit" aria-hidden>
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="none">
        <defs>
          <radialGradient id="pl" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="var(--accent)" stopOpacity=".0" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity=".14" />
          </radialGradient>
        </defs>
        {[260, 360, 460, 560, 680].map((r) => (
          <circle key={r} cx={BALL_CX} cy={BALL_CY} r={r} fill="none" stroke="var(--accent)" strokeOpacity={0.05 + (680 - r) / 6000} strokeWidth="1" />
        ))}
        <g stroke="var(--accent)" strokeOpacity=".16" fill="none" strokeWidth="1.2" className="traces">
          <path d="M0 150 H420 L460 110 H1920" />
          <path d="M0 1010 H260 L300 970 H820 L850 1000 H1920" />
          <path d="M660 160 V900 L690 930 V1080" />
          <path d="M1900 160 V600 L1870 630 V1080" />
          <path d="M700 880 H1880" />
        </g>
        <g fill="var(--accent)" fillOpacity=".45">
          {[[420, 150], [460, 110], [300, 970], [850, 1000], [660, 900], [1870, 630]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3.5" />)}
        </g>
      </svg>
      <div className="circuit-pulse" />
    </div>
  );
}

function SlotSpinner({ ps, duration }: { ps: PublicState; duration: number }) {
  const [v, setV] = useState(ps.sym.poolMin);
  useEffect(() => {
    let alive = true;
    const start = performance.now();
    const n = ps.sym.poolMax - ps.sym.poolMin + 1;
    let timer = 0;
    const step = () => {
      if (!alive) return;
      const p = Math.min(1, (performance.now() - start) / duration);
      setV(ps.sym.poolMin + Math.floor(Math.random() * n));
      timer = window.setTimeout(step, 45 + 340 * Math.pow(p, 3));
    };
    step();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [ps.sym.poolMin, ps.sym.poolMax, duration]);
  return <BallFace cfg={ps.sym} value={v} />;
}

type Anim = { phase: 'spin' | 'stop' | 'fly'; value: number };

function useStageAnimation(ps: PublicState | null) {
  const [shown, setShown] = useState<number[]>([]);
  const [latest, setLatest] = useState<number | null>(null);
  const [anim, setAnim] = useState<Anim | null>(null);
  const [oneAway, setOneAway] = useState(0);
  const [hype, setHype] = useState(0);
  const known = useRef<number[] | null>(null);
  const timers = useRef<number[]>([]);
  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    if (!ps) return;
    const prev = known.current;
    const draws = ps.draws;
    if (prev && sameArr(prev, draws)) {
      if (!anim) setOneAway(ps.oneAway);
      return;
    }
    known.current = draws;
    const extendsByOne = prev && draws.length === prev.length + 1 && sameArr(prev, draws.slice(0, -1));
    clear();
    if (!extendsByOne) {
      setAnim(null);
      setShown(draws);
      setLatest(draws.length ? draws[draws.length - 1] : null);
      setOneAway(ps.oneAway);
      return;
    }
    const value = draws[draws.length - 1];
    const reduced = prefersReducedMotion();
    const tm = animTiming(ps.settings.speed, reduced);
    const prevOne = oneAway;
    const nextOne = ps.oneAway;
    const speech = ps.lastSpeech;
    const voice = ps.settings.voice;
    const vol = ps.settings.volume;
    setShown(prev!);
    setAnim({ phase: 'spin', value });
    if (!reduced) {
      drumRoll(tm.spin);
      spinTicks(tm.spin);
    }
    timers.current.push(
      window.setTimeout(() => {
        setLatest(value);
        setAnim({ phase: 'stop', value });
        ding();
        if (voice) speak(speech, vol);
      }, tm.spin),
      window.setTimeout(() => {
        if (tm.fly) {
          setAnim({ phase: 'fly', value });
          whoosh();
        }
      }, tm.spin + tm.settle),
      window.setTimeout(() => {
        setAnim(null);
        setShown(draws);
        setOneAway(nextOne);
        if (nextOne - prevOne >= Math.max(3, prevOne * 0.5) && nextOne >= 3) {
          setHype(Date.now());
          chime();
        }
      }, tm.spin + tm.settle + tm.fly),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ps?.draws, ps?.oneAway]);

  useEffect(() => clear, []);
  return { shown, latest, anim, oneAway, hype };
}

function Digit({ final, stopAt, start }: { final: string; stopAt: number; start: number }) {
  const [d, setD] = useState('0');
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDone(false);
    const iv = window.setInterval(() => {
      if (performance.now() - start >= stopAt) {
        setD(final);
        setDone(true);
        clearInterval(iv);
      } else setD(String(Math.floor(Math.random() * 10)));
    }, 55);
    return () => clearInterval(iv);
  }, [final, stopAt, start]);
  return <span className={`digit ${done ? 'done' : ''}`}>{d}</span>;
}

function RevealOverlay({ reveal, ps }: { reveal: RevealPayload; ps: PublicState }) {
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<'dim' | 'roll' | 'boom' | 'card'>('dim');
  const [start, setStart] = useState(performance.now());
  const reduced = prefersReducedMotion();
  const tm = revealTiming(ps.settings.speed, reduced);
  const drawn = useMemo(() => new Set(ps.draws), [ps.draws]);

  useEffect(() => {
    setIdx(0);
  }, [reveal.seq]);

  useEffect(() => {
    const timers: number[] = [];
    setPhase('dim');
    timers.push(
      window.setTimeout(() => {
        setPhase('roll');
        setStart(performance.now());
        drumRoll(tm.roll);
      }, tm.dim),
      window.setTimeout(() => {
        setPhase('boom');
        fanfare();
        if (!reduced) {
          const shoot = (x: number, angle: number) =>
            confetti({ particleCount: 140, spread: 75, angle, origin: { x, y: 0.75 }, startVelocity: 62, ticks: 320, colors: ['#ffd76a', '#ffffff', getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6EBE49', '#ff6b8b'], disableForReducedMotion: true, zIndex: 9999 });
          shoot(0.1, 60);
          shoot(0.9, 120);
          setTimeout(() => confetti({ particleCount: 220, spread: 160, origin: { x: 0.5, y: 0.35 }, startVelocity: 45, ticks: 360, disableForReducedMotion: true, zIndex: 9999 }), 350);
        }
        if (ps.settings.voice) speak(`บิงโก! ใบที่ ${reveal.cards[idx]?.no ?? ''}`, ps.settings.volume);
      }, tm.dim + tm.roll),
      window.setTimeout(() => setPhase('card'), tm.dim + tm.roll + tm.boom),
    );
    if (idx < reveal.cards.length - 1) timers.push(window.setTimeout(() => setIdx((i) => i + 1), tm.dim + tm.roll + tm.boom + tm.card));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal.seq, idx]);

  const card = reveal.cards[idx];
  if (!card) return null;
  const digits = formatCardNo(card.no).slice(1).split('');
  const stepMs = tm.roll / (digits.length + 0.5);
  return (
    <div className={`reveal rv-${phase}`}>
      <div className="spotlight" />
      <div className="reveal-inner">
        <div className="reveal-round">
          {reveal.roundName} {reveal.prize && <span>· {reveal.prize}</span>}
          {reveal.cards.length > 1 && <span className="reveal-count"> ({idx + 1}/{reveal.cards.length})</span>}
        </div>
        {phase !== 'card' ? (
          <>
            <div className="reveal-label">{t.display.winner}</div>
            <div className="reveal-number">
              <span className="hash">#</span>
              {phase === 'dim' ? digits.map((_, i) => <span key={i} className="digit">?</span>) : digits.map((d, i) => <Digit key={i + '-' + reveal.seq + '-' + idx} final={d} stopAt={stepMs * (i + 1)} start={start} />)}
            </div>
            {phase === 'boom' && <div className="reveal-bingo">{t.display.bingo}</div>}
          </>
        ) : (
          <div className="reveal-card-wrap">
            <div className="reveal-card-no">{t.display.card} {formatCardNo(card.no)}</div>
            <div className="reveal-card">
              <CardView cfg={{ ...ps.sym, eventName: ps.eventName, eventDate: ps.eventDate }} card={card} drawn={drawn} highlight={card.win} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Stage({ ps, waiting = false, interactive = true }: { ps: PublicState | null; waiting?: boolean; interactive?: boolean }) {
  const { shown, latest, anim, oneAway, hype } = useStageAnimation(ps);
  const [rulesLocal, setRulesLocal] = useState<boolean | null>(null);
  const [hypeOn, setHypeOn] = useState(false);
  const [flyGo, setFlyGo] = useState(false);

  useEffect(() => {
    if (ps) setAudio(ps.settings.sound, ps.settings.volume);
  }, [ps?.settings.sound, ps?.settings.volume]);
  useEffect(() => setRulesLocal(null), [ps?.rulesOpen]);
  useEffect(() => {
    if (!hype) return;
    setHypeOn(true);
    const tm = setTimeout(() => setHypeOn(false), 2600);
    return () => clearTimeout(tm);
  }, [hype]);
  useEffect(() => {
    if (anim?.phase === 'fly') {
      setFlyGo(false);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setFlyGo(true)));
      return () => cancelAnimationFrame(r);
    }
  }, [anim?.phase, anim?.value]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRulesLocal(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const layout = useMemo(() => (ps ? boardLayout(ps.sym, BOARD) : null), [ps?.sym]);
  const shownSet = useMemo(() => new Set(shown), [shown]);

  if (!ps || !layout) {
    return (
      <ScaledStage>
        <div className="stage-empty">
          <div className="title-grad stage-empty-title">BINGO</div>
          <div className="waiting-badge big">{t.display.waiting}</div>
        </div>
      </ScaledStage>
    );
  }

  const round = ps.rounds[ps.currentRound];
  const hiding = new Set(ps.reveal ? ps.reveal.cards.map((c) => ps.reveal!.round + ':' + c.no) : []);
  const hall = ps.hall.map((h) => ({ ...h, cards: h.cards.filter((c) => !hiding.has(h.round + ':' + c)) })).filter((h) => h.cards.length > 0);
  const total = ps.sym.poolMax - ps.sym.poolMin + 1;
  const recent = shown.slice(-8).reverse();
  const heat = Math.min(1, oneAway / 20);
  const rulesOpen = rulesLocal ?? ps.rulesOpen;
  const flyTarget = anim?.phase === 'fly' ? layout.cells.get(anim.value) : undefined;
  const ballNo = anim ? ps.draws.length : shown.length;

  return (
    <ScaledStage>
      <Decor kind={getTheme(ps.themeId).decor} />

      {/* header */}
      <header className="st-header">
        <div className="st-event">
          {ps.eventLogo && <SymbolView item={{ id: 'logo', label: '', image: ps.eventLogo }} className="st-logo" badge={false} />}
          <div>
            <div className="st-event-name title-grad">{ps.eventName}</div>
            {ps.eventDate && <div className="st-event-date">{ps.eventDate}</div>}
          </div>
        </div>
        {round && (
          <div className="st-round">
            <div className="st-round-name">{round.name}</div>
            <div className="st-prize">{round.prize}</div>
          </div>
        )}
        {round && (
          <div className="st-pattern">
            <PatternGrid size={ps.sym.size} cells={round.cells} className="st-pgrid" />
            <div className="st-pattern-name">{round.patternName}</div>
          </div>
        )}
      </header>

      {/* latest ball */}
      <div className={`st-latest ${anim?.phase === 'spin' ? 'spinning' : ''} ${anim?.phase === 'stop' ? 'stopped' : ''}`} style={{ left: BALL_CX - BALL_SIZE / 2, top: BALL_CY - BALL_SIZE / 2, width: BALL_SIZE, height: BALL_SIZE }}>
        <span className="ball ball-hero" style={{ width: BALL_SIZE, height: BALL_SIZE, fontSize: BALL_SIZE / 100 + 'px' }}>
          <span className="ball-shell" />
          <span className="ball-hub">
            {anim?.phase === 'spin' ? (
              <SlotSpinner ps={ps} duration={animTiming(ps.settings.speed, prefersReducedMotion()).spin} />
            ) : latest !== null ? (
              <BallFace cfg={ps.sym} value={latest} />
            ) : (
              <span className="ball-wait">{t.display.waitingFirst}</span>
            )}
          </span>
          <span className="ball-gloss" />
        </span>
        {anim?.phase === 'stop' && <span className="flash" />}
      </div>
      <div className="st-ballno">{ballNo > 0 ? `${t.common.draw} ${ballNo}` : ' '}</div>
      <div className="st-count">{t.display.drawn(shown.length, total)}</div>

      {/* flying ball */}
      {anim?.phase === 'fly' && flyTarget && (
        <span
          className="fly"
          style={{
            left: BALL_CX - BALL_SIZE / 2,
            top: BALL_CY - BALL_SIZE / 2,
            transform: flyGo ? `translate(${flyTarget.x - BALL_CX}px, ${flyTarget.y - BALL_CY}px) scale(${(flyTarget.s * 0.86) / BALL_SIZE})` : 'none',
          }}
        >
          <Ball cfg={ps.sym} value={anim.value} size={BALL_SIZE} />
        </span>
      )}

      {/* recent strip */}
      <div className="st-recent">
        {recent.map((v, i) => (
          <Ball key={v + '-' + i} cfg={ps.sym} value={v} size={i === 0 ? 88 : 70} className={i === 0 ? 'recent-first' : ''} />
        ))}
      </div>

      {/* master board */}
      <div className="st-board">
        {layout.headers.map((h, i) => (
          <div key={i} className="st-board-h" style={{ left: h.x, top: h.y, width: h.w, height: h.h }}>
            {ps.sym.mode === 'columnLogo' ? <SymbolView item={h.item} /> : <span>{h.item.label}</span>}
          </div>
        ))}
        {[...layout.cells.entries()].map(([v, c]) => {
          const on = shownSet.has(v);
          const isLatest = on && v === shown[shown.length - 1] && !anim;
          return (
            <div key={v} className={`st-cell ${on ? 'on' : ''} ${isLatest ? 'latest' : ''}`} style={{ left: c.x - c.s / 2, top: c.y - c.s / 2, width: c.s, height: c.s, fontSize: c.s / 100 + 'px' }}>
              <span className="st-cell-in">
                {ps.sym.mode === 'image' ? <SymbolView item={ps.sym.items[v - ps.sym.poolMin]} /> : <span className="st-cell-num">{v}</span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* suspense meter */}
      <div className={`st-meter ${oneAway > 0 ? 'hot' : ''}`} style={{ ['--heat' as string]: heat }}>
        <div className="st-meter-text">{oneAway > 0 ? t.display.oneAway(oneAway) : t.display.noneAway}</div>
        <div className="st-meter-bar"><span style={{ width: `${Math.max(4, heat * 100)}%` }} /></div>
      </div>

      {/* winners hall */}
      <div className="st-hall">
        <div className="st-hall-title">{t.display.winnersHall}</div>
        <div className="st-hall-rows">
          {hall.length === 0 && <div className="st-hall-empty">—</div>}
          {hall.map((h) => (
            <div key={h.round} className="st-hall-row">
              <span className="st-hall-round">{h.roundName}</span>
              <span className="st-hall-prize">{h.prize}</span>
              <span className="st-hall-cards">{h.cards.map((c) => <b key={c}>{formatCardNo(c)}</b>)}</span>
            </div>
          ))}
        </div>
      </div>

      {interactive && (
        <button className="st-rules-btn" onClick={() => setRulesLocal(!rulesOpen)}>{t.display.rules}</button>
      )}
      {waiting && <div className="waiting-badge">{t.display.waiting}</div>}
      {hypeOn && <div className="hype">{t.display.hype}</div>}

      {ps.paused && (
        <div className="overlay paused-overlay">
          <div className="paused-text title-grad">{t.display.paused}</div>
        </div>
      )}
      {ps.finished && !ps.reveal && <div className="finished-banner title-grad">{t.display.gameOver}</div>}
      {ps.showCard && !ps.reveal && (
        <div className="overlay showcard-overlay">
          <div className={`showcard-status ${ps.showCard.ok ? 'ok' : ''}`}>{ps.showCard.status}</div>
          <div className="showcard-card">
            <CardView cfg={{ ...ps.sym, eventName: ps.eventName, eventDate: ps.eventDate }} card={ps.showCard.card} drawn={shownSet} highlight={ps.showCard.card.win} />
          </div>
        </div>
      )}
      {ps.reveal && <RevealOverlay reveal={ps.reveal} ps={ps} />}
      {rulesOpen && (
        <div className="overlay rules-overlay" onClick={() => setRulesLocal(false)}>
          <div className="rules-box" onClick={(e) => e.stopPropagation()}>
            <pre>{ps.rules}</pre>
            <div className="rules-hint">Esc</div>
          </div>
        </div>
      )}
    </ScaledStage>
  );
}
