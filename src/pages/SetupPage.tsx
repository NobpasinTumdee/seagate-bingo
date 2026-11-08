import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildAttemptMap, checkCode, getCard } from '../core/cards';
import { DEFAULT_RULES } from '../core/game';
import { BUILTIN_PATTERNS, compilePattern, previewGrid } from '../core/patterns';
import { newId, newSeed } from '../core/rng';
import { DEFAULT_POOL, hasFreeCell, poolSize, poolWarnings, validatePool } from '../core/symbols';
import type { CardSize, GameConfig, Round, SymbolItem, SymbolMode, SymbolSet } from '../core/types';
import { CardView } from '../components/CardView';
import { Estimator } from '../components/Estimator';
import { SymbolSetEditor } from '../components/SymbolSetEditor';
import { SymbolView } from '../components/SymbolView';
import { Modal, NoGame, PatternGrid, TopNav, useConfirm } from '../components/ui';
import { t } from '../i18n/th';
import { exportBackup } from '../state/backupIO';
import { dispatch, duplicateGame, useGame } from '../state/gameStore';
import { saveImage } from '../state/images';
import { CLASSIC_SET, useSymbolSets } from '../state/symbolSets';
import { THEMES } from '../themes';

const SIZES: CardSize[] = [3, 4, 5, 6];
const BRAND_LOGOS = ['/assets/brand/event-logo.svg', '/assets/brand/event-logo.png'];

function modesFor(set: SymbolSet): SymbolMode[] {
  if (set.id === 'classic') return ['number'];
  const m: SymbolMode[] = [];
  if ((set.columns?.length ?? 0) > 0) m.push('columnLogo');
  if ((set.items?.length ?? 0) > 0) m.push('image');
  m.push('number');
  return m;
}

/** Build the config patch for a symbol set / mode / column order choice */
function symbolPatch(cfg: GameConfig, set: SymbolSet, mode: SymbolMode, order?: SymbolItem[]): Partial<GameConfig> {
  const base: Partial<GameConfig> = { symbolSetId: set.id, mode };
  if (mode === 'image') {
    const items = set.items ?? [];
    return { ...base, items, columns: [], poolMin: 1, poolMax: Math.max(1, items.length) };
  }
  const pool = cfg.mode === 'image' ? { poolMin: 1, poolMax: DEFAULT_POOL[cfg.size] } : {};
  if (mode === 'columnLogo') {
    const cols = order ?? orderedColumns(cfg, set);
    return { ...base, ...pool, items: [], columns: cols.slice(0, cfg.size) };
  }
  return { ...base, ...pool, items: [], columns: [] };
}

function orderedColumns(cfg: GameConfig, set: SymbolSet): SymbolItem[] {
  const all = set.columns ?? [];
  const chosen = cfg.columns.map((c) => all.find((a) => a.id === c.id)).filter((x): x is SymbolItem => !!x);
  return [...chosen, ...all.filter((a) => !chosen.some((c) => c.id === a.id))];
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="panel setup-section">
      <div className="row between">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function CustomPatternEditor({ size, onSave }: { size: CardSize; onSave: (name: string, cells: number[]) => void }) {
  const [cells, setCells] = useState<number[]>([]);
  const [name, setName] = useState('');
  return (
    <div className="custom-pattern">
      <p className="dim small">{t.setup.customPatternHint}</p>
      <div className="pgrid pgrid-edit" style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
        {Array.from({ length: size * size }, (_, i) => (
          <button key={i} type="button" className={cells.includes(i) ? 'on' : ''} onClick={() => setCells((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))} />
        ))}
      </div>
      <div className="row gap-s">
        <input placeholder={t.setup.customName} value={name} onChange={(e) => setName(e.target.value)} />
        <button
          type="button"
          className="btn btn-s"
          disabled={!name.trim() || cells.length === 0}
          onClick={() => {
            onSave(name.trim(), cells.slice().sort((a, b) => a - b));
            setCells([]);
            setName('');
          }}
        >
          {t.setup.saveCustom}
        </button>
      </div>
    </div>
  );
}

export default function SetupPage() {
  const game = useGame();
  const nav = useNavigate();
  const sets = useSymbolSets();
  const confirm = useConfirm();
  const [setsOpen, setSetsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [doneOpen, setDoneOpen] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);

  const cfg = game?.config;
  const set = useMemo(() => sets.find((s) => s.id === cfg?.symbolSetId) ?? CLASSIC_SET, [sets, cfg?.symbolSetId]);

  if (!game || !cfg) return <NoGame />;
  const locked = game.locked;
  const patch = (p: Partial<GameConfig>) => dispatch({ type: 'UPDATE_CONFIG', patch: p });
  const setRounds = (rounds: Round[]) => patch({ rounds });
  const updateRound = (id: string, p: Partial<Round>) => setRounds(cfg.rounds.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const changeSize = (size: CardSize) => {
    const next = { ...cfg, size };
    const p: Partial<GameConfig> = { size, freeCenter: size % 2 === 1 ? (cfg.freeCenter || size === 5) : false };
    if (cfg.mode !== 'image') {
      p.poolMin = 1;
      p.poolMax = DEFAULT_POOL[size];
    }
    if (cfg.mode === 'columnLogo') p.columns = orderedColumns(next, set).slice(0, size);
    patch(p);
  };

  const columnOrder = cfg.mode === 'columnLogo' ? orderedColumns(cfg, set) : [];
  const poolErrors = validatePool(cfg);
  const warnings = poolWarnings(cfg);
  const ps = poolSize(cfg);
  const availablePatterns = [
    ...BUILTIN_PATTERNS,
    ...cfg.customPatterns.filter((p) => !p.size || p.size === cfg.size),
  ];

  const sampleSeed = game.seed ?? 'preview-seed';
  const sample = poolErrors.length === 0 ? getCard(cfg, sampleSeed, game.attempts, cfg.startNumber) : null;

  const validateAll = (): string[] => {
    const errs = [...poolErrors];
    if (!cfg.eventName.trim()) errs.push('กรุณาใส่ชื่องาน');
    if (cfg.rounds.length === 0) errs.push('ต้องมีอย่างน้อย 1 รอบ');
    cfg.rounds.forEach((r) => {
      const valid = r.patternIds.filter((id) => compilePattern(id, cfg.size, cfg.customPatterns).masks.length > 0);
      if (valid.length === 0) errs.push(`${r.name}: ยังไม่ได้เลือกลายที่ชนะ`);
      if (!(r.winnersWanted >= 1)) errs.push(`${r.name}: จำนวนผู้ชนะต้องอย่างน้อย 1`);
    });
    if (!(cfg.cardCount >= 1 && cfg.cardCount <= 2000)) errs.push('จำนวนใบต้องอยู่ระหว่าง 1–2000');
    if (!(cfg.startNumber >= 0 && cfg.startNumber + cfg.cardCount <= 100000)) errs.push('เลขใบเริ่มต้นไม่ถูกต้อง');
    return errs;
  };

  const generate = () => {
    const errs = validateAll();
    setErrors(errs);
    if (errs.length) return;
    confirm.ask(t.setup.confirmGenerate, () => {
      setBusy(true);
      setTimeout(() => {
        try {
          const seed = newSeed();
          const attempts = buildAttemptMap(cfg, seed);
          // strip rounds' invalid pattern ids before locking
          patch({
            rounds: cfg.rounds.map((r) => ({ ...r, patternIds: r.patternIds.filter((id) => compilePattern(id, cfg.size, cfg.customPatterns).masks.length > 0) })),
            freeCenter: hasFreeCell(cfg),
          });
          dispatch({ type: 'GENERATE', seed, attempts });
          setDoneOpen(true);
        } catch (e) {
          setErrors([String((e as Error).message)]);
        } finally {
          setBusy(false);
        }
      }, 30);
    });
  };

  const onLogoUpload = async (f?: File) => {
    if (!f) return;
    patch({ eventLogo: await saveImage(f) });
  };

  return (
    <div className="page">
      <TopNav
        right={
          <select className="theme-select" value={game.settings.themeId} onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { themeId: e.target.value } })} aria-label={t.control.theme}>
            {THEMES.map((th) => <option key={th.id} value={th.id}>{th.name}</option>)}
          </select>
        }
      />
      <main className="container setup">
        <div className="setup-title row between">
          <h1 className="title-grad">{t.setup.title}</h1>
          {locked && (
            <div className="row gap-s">
              <button className="btn" onClick={() => nav('/print')}>{t.setup.goPrint}</button>
              <button className="btn btn-primary" onClick={() => { duplicateGame(game.id); }}>{t.setup.duplicate}</button>
            </div>
          )}
        </div>
        {locked && <div className="notice warn">🔒 {t.setup.locked}</div>}

        <div className="setup-grid">
          <fieldset disabled={locked} className="setup-col">
            <Section title={t.setup.event}>
              <label className="field">
                <span>{t.setup.eventName}</span>
                <input value={cfg.eventName} maxLength={60} onChange={(e) => patch({ eventName: e.target.value })} />
              </label>
              <div className="field">
                <span>{t.setup.eventLogo}</span>
                <div className="row gap-s wrap">
                  <div className="logo-preview">
                    {cfg.eventLogo ? <SymbolView item={{ id: 'l', label: 'LOGO', image: cfg.eventLogo }} /> : <span className="dim small">{t.common.none}</span>}
                  </div>
                  <select value={BRAND_LOGOS.includes(cfg.eventLogo ?? '') ? cfg.eventLogo : cfg.eventLogo ? 'custom' : ''} onChange={(e) => e.target.value !== 'custom' && patch({ eventLogo: e.target.value || undefined })}>
                    {BRAND_LOGOS.map((p) => <option key={p} value={p}>{p.split('/').pop()}</option>)}
                    {cfg.eventLogo && !BRAND_LOGOS.includes(cfg.eventLogo) && <option value="custom">อัปโหลดแล้ว</option>}
                    <option value="">{t.setup.removeLogo}</option>
                  </select>
                  <label className="btn btn-s">
                    {t.setup.uploadLogo}
                    <input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" hidden onChange={(e) => onLogoUpload(e.target.files?.[0])} />
                  </label>
                </div>
              </div>
              <label className="field">
                <span>{t.setup.eventDate}</span>
                <input value={cfg.eventDate ?? ''} placeholder="31 ธันวาคม 2569" onChange={(e) => patch({ eventDate: e.target.value })} />
              </label>
            </Section>

            <Section title={t.setup.cardSize}>
              <div className="seg">
                {SIZES.map((s) => (
                  <button key={s} type="button" className={cfg.size === s ? 'active' : ''} onClick={() => changeSize(s)}>
                    {s}×{s}
                  </button>
                ))}
              </div>
              <label className="check">
                <input type="checkbox" checked={hasFreeCell(cfg)} disabled={cfg.size % 2 === 0} onChange={(e) => patch({ freeCenter: e.target.checked })} />
                {t.setup.freeCenter}
              </label>
            </Section>

            <Section title={t.setup.symbols} aside={<button type="button" className="btn btn-s" onClick={() => setSetsOpen(true)}>{t.setup.manageSets}</button>}>
              <div className="row gap wrap">
                <label className="field grow">
                  <span>{t.setup.symbolSet}</span>
                  <select
                    value={set.id}
                    onChange={(e) => {
                      const s = sets.find((x) => x.id === e.target.value) ?? CLASSIC_SET;
                      const m = modesFor(s);
                      patch(symbolPatch(cfg, s, m.includes(s.mode) ? s.mode : m[0]));
                    }}
                  >
                    {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="field grow">
                  <span>{t.setup.mode}</span>
                  <select value={cfg.mode} onChange={(e) => patch(symbolPatch(cfg, set, e.target.value as SymbolMode))}>
                    {modesFor(set).map((m) => <option key={m} value={m}>{t.setup.modes[m]}</option>)}
                  </select>
                </label>
              </div>
              {cfg.mode === 'columnLogo' && (
                <div>
                  <p className="dim small">{t.setup.columnOrder.replace('{n}', String(cfg.size))}</p>
                  <div className="col-order">
                    {columnOrder.map((c, i) => (
                      <div
                        key={c.id}
                        className={`col-chip ${i < cfg.size ? 'used' : 'unused'}`}
                        draggable={!locked}
                        onDragStart={() => setDrag(i)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (drag === null) return;
                          const arr = columnOrder.slice();
                          const [m] = arr.splice(drag, 1);
                          arr.splice(i, 0, m);
                          patch(symbolPatch(cfg, set, 'columnLogo', arr));
                          setDrag(null);
                        }}
                      >
                        <span className="col-idx">{i < cfg.size ? i + 1 : '–'}</span>
                        <SymbolView item={c} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {cfg.mode === 'image' ? (
                <p className="dim">{t.setup.imagePool(cfg.items.length)}</p>
              ) : (
                <div className="row gap wrap">
                  <label className="field">
                    <span>{t.setup.poolFrom}</span>
                    <input type="number" min={0} value={cfg.poolMin} onChange={(e) => patch({ poolMin: parseInt(e.target.value || '0', 10) })} />
                  </label>
                  <label className="field">
                    <span>{t.setup.poolTo}</span>
                    <input type="number" min={1} value={cfg.poolMax} onChange={(e) => patch({ poolMax: parseInt(e.target.value || '0', 10) })} />
                  </label>
                  <p className="dim small self-end">{t.setup.poolInfo(ps, Math.floor(ps / cfg.size))}</p>
                </div>
              )}
              {poolErrors.map((e) => <div key={e} className="notice bad">{e}</div>)}
              {warnings.map((e) => <div key={e} className="notice warn">{e}</div>)}
            </Section>

            <Section title={t.setup.rounds}>
              {cfg.rounds.map((r, idx) => (
                <div key={r.id} className="round-edit">
                  <div className="row gap wrap">
                    <span className="round-no">{idx + 1}</span>
                    <label className="field grow">
                      <span>{t.setup.roundName}</span>
                      <input value={r.name} onChange={(e) => updateRound(r.id, { name: e.target.value })} />
                    </label>
                    <label className="field grow">
                      <span>{t.setup.prize}</span>
                      <input value={r.prize} onChange={(e) => updateRound(r.id, { prize: e.target.value })} />
                    </label>
                    <label className="field narrow">
                      <span>{t.setup.winnersWanted}</span>
                      <input type="number" min={1} max={50} value={r.winnersWanted} onChange={(e) => updateRound(r.id, { winnersWanted: Math.max(1, parseInt(e.target.value || '1', 10)) })} />
                    </label>
                    <div className="round-tools">
                      <button type="button" className="btn-icon" disabled={idx === 0} onClick={() => { const a = cfg.rounds.slice(); [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]]; setRounds(a); }} aria-label="up">▲</button>
                      <button type="button" className="btn-icon" disabled={idx === cfg.rounds.length - 1} onClick={() => { const a = cfg.rounds.slice(); [a[idx + 1], a[idx]] = [a[idx], a[idx + 1]]; setRounds(a); }} aria-label="down">▼</button>
                      <button type="button" className="btn-icon danger" disabled={cfg.rounds.length <= 1} onClick={() => setRounds(cfg.rounds.filter((x) => x.id !== r.id))} aria-label={t.common.delete}>✕</button>
                    </div>
                  </div>
                  <div className="dim small">{t.setup.patterns}</div>
                  <div className="pattern-picks">
                    {availablePatterns.map((p) => {
                      const on = r.patternIds.includes(p.id);
                      const comp = compilePattern(p.id, cfg.size, cfg.customPatterns);
                      return (
                        <button
                          type="button"
                          key={p.id}
                          className={`pattern-pick ${on ? 'on' : ''}`}
                          onClick={() => updateRound(r.id, { patternIds: on ? r.patternIds.filter((x) => x !== p.id) : [...r.patternIds, p.id] })}
                        >
                          <PatternGrid size={cfg.size} cells={previewGrid(comp, cfg.size)} />
                          <span>{p.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn"
                onClick={() => setRounds([...cfg.rounds, { id: newId('r'), name: `รอบที่ ${cfg.rounds.length + 1}`, prize: '', winnersWanted: 1, patternIds: ['anyLine'] }])}
              >
                {t.setup.addRound}
              </button>
              <label className="check">
                <input type="checkbox" checked={cfg.allowRepeatWinners} onChange={(e) => patch({ allowRepeatWinners: e.target.checked })} />
                {t.setup.allowRepeat}
              </label>
              <details className="custom-wrap">
                <summary>{t.setup.customPattern}</summary>
                <CustomPatternEditor size={cfg.size} onSave={(name, cells) => patch({ customPatterns: [...cfg.customPatterns, { id: newId('cp'), name, size: cfg.size, cells }] })} />
                <div className="row gap-s wrap">
                  {cfg.customPatterns.map((p) => (
                    <span key={p.id} className="tag">
                      {p.name} ({p.size}×{p.size})
                      <button type="button" className="btn-icon danger" onClick={() => patch({ customPatterns: cfg.customPatterns.filter((x) => x.id !== p.id), rounds: cfg.rounds.map((r) => ({ ...r, patternIds: r.patternIds.filter((x) => x !== p.id) })) })}>✕</button>
                    </span>
                  ))}
                </div>
              </details>
            </Section>

            <Section title={t.setup.cardsSection}>
              <div className="row gap wrap">
                <label className="field">
                  <span>{t.setup.cardCount}</span>
                  <input type="number" min={1} max={2000} value={cfg.cardCount} onChange={(e) => patch({ cardCount: Math.min(2000, Math.max(1, parseInt(e.target.value || '1', 10))) })} />
                </label>
                <label className="field">
                  <span>{t.setup.startNumber}</span>
                  <input type="number" min={0} value={cfg.startNumber} onChange={(e) => patch({ startNumber: Math.max(0, parseInt(e.target.value || '0', 10)) })} />
                </label>
              </div>
            </Section>

            <Section title={t.setup.rules} aside={<button type="button" className="btn btn-s" onClick={() => patch({ rules: DEFAULT_RULES })}>ค่าเริ่มต้น</button>}>
              <textarea rows={8} value={cfg.rules} onChange={(e) => patch({ rules: e.target.value })} />
            </Section>
          </fieldset>

          <aside className="setup-side">
            <div className="panel sticky">
              <Estimator cfg={cfg} />
              {sample && (
                <div className="sample-card">
                  <CardView cfg={cfg} card={sample} code={game.seed ? checkCode(game.seed, sample.no) : 'ABCD'} variant={game.settings.printStyle} />
                </div>
              )}
              {errors.length > 0 && (
                <div className="notice bad">
                  <b>{t.setup.errorsTitle}</b>
                  <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
                </div>
              )}
              {!locked ? (
                <button className="btn btn-primary btn-xl full" disabled={busy} onClick={generate}>
                  {busy ? t.setup.generating : t.setup.generate}
                </button>
              ) : (
                <div className="col gap-s">
                  <button className="btn btn-primary btn-lg full" onClick={() => nav('/print')}>{t.setup.goPrint}</button>
                  <button className="btn btn-lg full" onClick={() => nav('/control')}>{t.setup.goControl}</button>
                  <button className="btn full" onClick={() => exportBackup(game)}>{t.control.exportBackup}</button>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
      <SymbolSetEditor open={setsOpen} onClose={() => setSetsOpen(false)} initialId={set.id !== 'classic' ? set.id : undefined} />
      <Modal open={doneOpen} onClose={() => setDoneOpen(false)} title={t.setup.generated}>
        <p>{t.setup.backupPrompt}</p>
        <div className="row gap end wrap">
          <button className="btn" onClick={() => setDoneOpen(false)}>{t.setup.later}</button>
          <button className="btn btn-primary" onClick={async () => { await exportBackup(game); }}>{t.setup.exportNow}</button>
          <button className="btn btn-primary" onClick={() => nav('/print')}>{t.setup.goPrint}</button>
        </div>
      </Modal>
      {confirm.node}
    </div>
  );
}
