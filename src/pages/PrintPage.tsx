import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { checkCode, getCard } from '../core/cards';
import type { GameRecord } from '../core/game';
import { CardView } from '../components/CardView';
import { downloadBlob, NoGame, TopNav } from '../components/ui';
import { t } from '../i18n/th';
import { cardBox, LAYOUTS, pageSlots, perPage } from '../print/layouts';
import { exportPdf } from '../print/pdfExport';
import { dispatch, useGame } from '../state/gameStore';
import { getTheme } from '../themes';

function Sheet({ game, startNo, endNo, variant, cutLines }: { game: GameRecord; startNo: number; endNo: number; variant: 'color' | 'ink'; cutLines: boolean }) {
  const cfg = game.config;
  const layout = LAYOUTS[cfg.size];
  const slots = pageSlots(layout);
  const nos: number[] = [];
  for (let k = 0; k < perPage(layout) && startNo + k <= endNo; k++) nos.push(startNo + k);
  return (
    <div className={`sheet ${cutLines ? 'cut' : ''}`}>
      {cutLines && (
        <>
          {Array.from({ length: layout.cols - 1 }, (_, c) => (
            <span key={'v' + c} className="cut-v" style={{ left: `${layout.margin + (c + 1) * ((layout.pageW - 2 * layout.margin + layout.gap) / layout.cols) - layout.gap / 2}mm` }} />
          ))}
          {Array.from({ length: layout.rows - 1 }, (_, r) => (
            <span key={'h' + r} className="cut-h" style={{ top: `${layout.margin + (r + 1) * ((layout.pageH - 2 * layout.margin + layout.gap) / layout.rows) - layout.gap / 2}mm` }} />
          ))}
        </>
      )}
      {nos.map((no, k) => {
        const box = cardBox(slots[k], cfg.size);
        const w = box.w * 0.94;
        return (
          <div key={no} className="sheet-slot" style={{ left: `${slots[k].x}mm`, top: `${slots[k].y}mm`, width: `${slots[k].w}mm`, height: `${slots[k].h}mm` }}>
            <div style={{ width: `${w}mm` }}>
              <CardView cfg={cfg} card={getCard(cfg, game.seed!, game.attempts, no)} code={checkCode(game.seed!, no)} variant={variant} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function PrintPage() {
  const game = useGame();
  const [rangeMode, setRangeMode] = useState<'all' | 'range'>('all');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [cutLines, setCutLines] = useState(true);
  const [pagesPerFile, setPagesPerFile] = useState(100);
  const [previewPage, setPreviewPage] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (game) {
      setFrom(game.config.startNumber);
      setTo(game.config.startNumber + game.config.cardCount - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id]);

  const range = useMemo(() => {
    if (!game) return { a: 0, b: -1 };
    const min = game.config.startNumber;
    const max = min + game.config.cardCount - 1;
    if (rangeMode === 'all') return { a: min, b: max };
    const a = Math.max(min, Math.min(max, from || min));
    const b = Math.max(a, Math.min(max, to || max));
    return { a, b };
  }, [game, rangeMode, from, to]);

  // print flow: render print-only DOM, wait for images, then print
  useEffect(() => {
    if (!printing) return;
    const after = () => setPrinting(false);
    window.addEventListener('afterprint', after);
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.print-root img'));
    const wait = Promise.race([
      Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => { i.onload = i.onerror = r; })))),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    wait.then(() => document.fonts?.ready).then(() => setTimeout(() => window.print(), 100));
    return () => window.removeEventListener('afterprint', after);
  }, [printing]);

  if (!game) return <NoGame />;
  if (!game.seed) {
    return (
      <div className="page">
        <TopNav />
        <div className="container"><div className="notice warn">{t.print.notGenerated}</div><Link className="btn btn-primary" to="/setup">{t.nav.setup}</Link></div>
      </div>
    );
  }

  const cfg = game.config;
  const layout = LAYOUTS[cfg.size];
  const per = perPage(layout);
  const count = range.b - range.a + 1;
  const pages = Math.ceil(count / per);
  const style = game.settings.printStyle;
  const theme = getTheme(game.settings.themeId);
  const pv = Math.min(previewPage, pages - 1);

  const runPdf = async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    setMessage(null);
    setProgress({ done: 0, total: pages });
    try {
      const res = await exportPdf(game, theme, {
        from: range.a,
        to: range.b,
        style,
        cutLines,
        pagesPerFile: Math.max(1, pagesPerFile),
        signal: ac.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      }, downloadBlob);
      setMessage(`${t.print.done} (${res.files} ไฟล์)` + (res.textDpiMin ? ` · ข้อความไทยแบบภาพ ≥ ${res.textDpiMin} DPI` : ''));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMessage(String((e as Error).message));
      else setMessage('ยกเลิกแล้ว');
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="page">
      <TopNav right={<Link className="btn btn-primary btn-s" to="/control">{t.nav.control} →</Link>} />
      <main className="container print-layout">
        <aside className="panel print-opts">
          <h1 className="title-grad">{t.print.title}</h1>
          <p className="dim">{t.print.pages(count, pages)}</p>
          <div className="field">
            <span>{t.print.range}</span>
            <div className="seg">
              <button className={rangeMode === 'all' ? 'active' : ''} onClick={() => setRangeMode('all')}>{t.print.all}</button>
              <button className={rangeMode === 'range' ? 'active' : ''} onClick={() => setRangeMode('range')}>{t.print.from}–{t.print.to}</button>
            </div>
            {rangeMode === 'range' && (
              <div className="row gap-s">
                <input type="number" value={from} onChange={(e) => setFrom(parseInt(e.target.value || '0', 10))} />
                <span>–</span>
                <input type="number" value={to} onChange={(e) => setTo(parseInt(e.target.value || '0', 10))} />
              </div>
            )}
          </div>
          <div className="field">
            <span>{t.print.style}</span>
            <div className="seg">
              <button className={style === 'color' ? 'active' : ''} onClick={() => dispatch({ type: 'SET_SETTINGS', patch: { printStyle: 'color' } })}>{t.print.color}</button>
              <button className={style === 'ink' ? 'active' : ''} onClick={() => dispatch({ type: 'SET_SETTINGS', patch: { printStyle: 'ink' } })}>{t.print.ink}</button>
            </div>
          </div>
          <label className="check"><input type="checkbox" checked={cutLines} onChange={(e) => setCutLines(e.target.checked)} />{t.print.cutLines}</label>
          <label className="field">
            <span>{t.print.perFile}</span>
            <input type="number" min={1} value={pagesPerFile} onChange={(e) => setPagesPerFile(parseInt(e.target.value || '100', 10))} />
          </label>
          <div className="col gap-s">
            <button className="btn btn-lg" disabled={!!progress || printing} onClick={() => setPrinting(true)}>{t.print.printNow}</button>
            <button className="btn btn-primary btn-lg" disabled={!!progress} onClick={runPdf}>{t.print.exportPdf}</button>
          </div>
          {progress && (
            <div className="progress-box">
              <div className="progress"><span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
              <div className="row between">
                <span>{t.print.exporting(Math.round((progress.done / Math.max(1, progress.total)) * 100))}</span>
                <button className="btn btn-s btn-danger" onClick={() => abortRef.current?.abort()}>{t.print.cancel}</button>
              </div>
            </div>
          )}
          {message && <div className="notice">{message}</div>}
        </aside>
        <section className="print-preview">
          <div className="row between">
            <h3>{t.print.preview}</h3>
            <div className="row gap-s">
              <button className="btn btn-s" disabled={pv <= 0} onClick={() => setPreviewPage(pv - 1)}>‹</button>
              <span className="dim">{pv + 1} / {pages}</span>
              <button className="btn btn-s" disabled={pv >= pages - 1} onClick={() => setPreviewPage(pv + 1)}>›</button>
            </div>
          </div>
          <div className="sheet-wrap">
            <Sheet game={game} startNo={range.a + pv * per} endNo={range.b} variant={style} cutLines={cutLines} />
          </div>
        </section>
      </main>
      {printing &&
        createPortal(
          <div className="print-root">
            {Array.from({ length: pages }, (_, p) => (
              <Sheet key={p} game={game} startNo={range.a + p * per} endNo={range.b} variant={style} cutLines={cutLines} />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
