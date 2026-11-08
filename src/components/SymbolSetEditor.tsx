import { useState } from 'react';
import { newId } from '../core/rng';
import type { SymbolItem, SymbolMode, SymbolSet } from '../core/types';
import { t } from '../i18n/th';
import { saveImage } from '../state/images';
import { deleteUserSet, saveUserSet, useSymbolSets } from '../state/symbolSets';
import { SymbolView } from './SymbolView';
import { Modal, useConfirm } from './ui';

const ACCEPT = 'image/png,image/svg+xml,image/webp,image/jpeg';

function ItemList({ items, editable, onChange }: { items: SymbolItem[]; editable: boolean; onChange: (items: SymbolItem[]) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const upload = async (files: FileList | null) => {
    if (!files) return;
    const add: SymbolItem[] = [];
    for (const f of Array.from(files)) {
      const ref = await saveImage(f);
      add.push({ id: newId('s'), label: f.name.replace(/\.[^.]+$/, '').slice(0, 24), image: ref });
    }
    onChange([...items, ...add]);
  };
  return (
    <div>
      <div className="sym-grid">
        {items.map((it, i) => (
          <div
            key={it.id}
            className="sym-tile"
            draggable={editable}
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag === null || drag === i) return;
              const arr = items.slice();
              const [m] = arr.splice(drag, 1);
              arr.splice(i, 0, m);
              onChange(arr);
              setDrag(null);
            }}
          >
            <SymbolView item={it} className="sym-tile-img" />
            {editable ? (
              <>
                <input value={it.label} onChange={(e) => onChange(items.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)))} aria-label={t.sets.label} />
                <input className="small" placeholder={t.sets.speech} value={it.speech ?? ''} onChange={(e) => onChange(items.map((x) => (x.id === it.id ? { ...x, speech: e.target.value } : x)))} />
                <button
                  className="btn-icon danger"
                  // images are kept in IndexedDB: games that were already generated may still use them
                  onClick={() => onChange(items.filter((x) => x.id !== it.id))}
                  aria-label={t.common.delete}
                >
                  ✕
                </button>
              </>
            ) : (
              <span className="small">{it.label}</span>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <label className="btn btn-s upload-btn">
          {t.sets.upload}
          <input type="file" multiple accept={ACCEPT} hidden onChange={(e) => upload(e.target.files)} />
        </label>
      )}
    </div>
  );
}

export function SymbolSetEditor({ open, onClose, initialId }: { open: boolean; onClose: () => void; initialId?: string }) {
  const sets = useSymbolSets().filter((s) => s.id !== 'classic');
  const [selId, setSelId] = useState<string | undefined>(initialId);
  const confirm = useConfirm();
  const sel = sets.find((s) => s.id === selId) ?? sets[0];

  const update = (patch: Partial<SymbolSet>) => sel && !sel.builtIn && saveUserSet({ ...sel, ...patch });
  const create = (mode: SymbolMode) => {
    const s: SymbolSet = { id: newId('set'), name: 'ชุดใหม่', mode, columns: [], items: [] };
    saveUserSet(s);
    setSelId(s.id);
  };
  const copy = () => {
    if (!sel) return;
    const s: SymbolSet = { ...structuredClone(sel), id: newId('set'), name: sel.name + ' (สำเนา)', builtIn: false };
    saveUserSet(s);
    setSelId(s.id);
  };

  return (
    <Modal open={open} onClose={onClose} title={t.sets.title} wide>
      <div className="sets-layout">
        <aside className="sets-list">
          {sets.map((s) => (
            <button key={s.id} className={`list-btn ${s.id === sel?.id ? 'active' : ''}`} onClick={() => setSelId(s.id)}>
              {s.name} <span className="dim small">{t.setup.modes[s.mode]}</span>
            </button>
          ))}
          <button className="btn btn-s" onClick={() => create('columnLogo')}>{t.sets.newSet} ({t.setup.modes.columnLogo})</button>
          <button className="btn btn-s" onClick={() => create('image')}>{t.sets.newSet} ({t.setup.modes.image})</button>
        </aside>
        {sel && (
          <section className="sets-detail">
            {sel.builtIn ? (
              <div className="notice">{t.sets.builtIn}</div>
            ) : (
              <label className="field">
                <span>{t.sets.name}</span>
                <input value={sel.name} onChange={(e) => update({ name: e.target.value })} />
              </label>
            )}
            {!sel.builtIn && (
              <label className="field">
                <span>{t.setup.mode}</span>
                <select value={sel.mode} onChange={(e) => update({ mode: e.target.value as SymbolMode })}>
                  <option value="columnLogo">{t.setup.modes.columnLogo}</option>
                  <option value="image">{t.setup.modes.image}</option>
                </select>
              </label>
            )}
            <h4>{t.sets.columns}</h4>
            <ItemList items={sel.columns ?? []} editable={!sel.builtIn} onChange={(columns) => update({ columns })} />
            <h4>{t.sets.items} ({sel.items?.length ?? 0})</h4>
            <ItemList items={sel.items ?? []} editable={!sel.builtIn} onChange={(items) => update({ items })} />
            <div className="row gap end">
              <button className="btn" onClick={copy}>{t.sets.copy}</button>
              {!sel.builtIn && (
                <button className="btn btn-danger" onClick={() => confirm.ask(`${t.sets.deleteSet}: ${sel.name}?`, () => { deleteUserSet(sel.id); setSelId(undefined); })}>
                  {t.sets.deleteSet}
                </button>
              )}
            </div>
          </section>
        )}
      </div>
      {confirm.node}
    </Modal>
  );
}
