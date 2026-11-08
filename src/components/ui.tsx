import { Component, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { t } from '../i18n/th';
import { onStorageWarning, STORAGE_FAIL } from '../state/storage';

export function PatternGrid({ size, cells, className = '' }: { size: number; cells: boolean[]; className?: string }) {
  return (
    <div className={'pgrid ' + className} style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
      {cells.map((on, i) => (
        <span key={i} className={on ? 'on' : ''} />
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false, className = '' }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean; className?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''} ${className}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn-icon" onClick={onClose} aria-label={t.common.close}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Promise-free confirm dialog state helper */
export function useConfirm() {
  const [state, setState] = useState<{ msg: string; onYes: () => void } | null>(null);
  const ask = (msg: string, onYes: () => void) => setState({ msg, onYes });
  const node = (
    <Modal open={!!state} onClose={() => setState(null)} title={t.common.confirm}>
      <p className="confirm-msg">{state?.msg}</p>
      <div className="row end gap">
        <button className="btn" onClick={() => setState(null)}>{t.common.cancel}</button>
        <button
          className="btn btn-primary"
          autoFocus
          onClick={() => {
            const fn = state?.onYes;
            setState(null);
            fn?.();
          }}
        >
          {t.common.confirm}
        </button>
      </div>
    </Modal>
  );
  return { ask, node, open: !!state };
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('[bingo] page error', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-page">
        <h1>{t.errors.title}</h1>
        <p>{t.errors.body}</p>
        <pre>{String(this.state.error.message)}</pre>
        <button className="btn btn-primary btn-lg" onClick={() => location.reload()}>{t.common.reload}</button>
      </div>
    );
  }
}

export function StorageBanner() {
  const [w, setW] = useState<string | null>(null);
  useEffect(() => onStorageWarning(setW), []);
  if (!w) return null;
  return <div className={`storage-banner ${w === STORAGE_FAIL ? 'bad' : ''}`}>{w === STORAGE_FAIL ? t.errors.storageFail : t.errors.storageNearlyFull}</div>;
}

export function NoGame() {
  return (
    <div className="page center-page">
      <h2>{t.errors.noGame}</h2>
      <Link className="btn btn-primary" to="/">{t.errors.goLibrary}</Link>
    </div>
  );
}

export function TopNav({ right }: { right?: ReactNode }) {
  return (
    <header className="topnav">
      <Link to="/" className="brand">
        <span className="brand-ball">B</span> {t.appName}
      </Link>
      <nav>
        <Link to="/">{t.nav.library}</Link>
        <Link to="/setup">{t.nav.setup}</Link>
        <Link to="/print">{t.nav.print}</Link>
        <Link to="/control">{t.nav.control}</Link>
      </nav>
      <div className="topnav-right">{right}</div>
    </header>
  );
}

export function downloadText(name: string, text: string, type = 'application/json') {
  downloadBlob(name, new Blob([text], { type }));
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
