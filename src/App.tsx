import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ErrorBoundary, StorageBanner } from './components/ui';
import { t } from './i18n/th';
import { useGame } from './state/gameStore';
import { checkStorageHealth } from './state/storage';
import { useTheme } from './themes';
import { LibraryPage } from './pages/LibraryPage';

const SetupPage = lazy(() => import('./pages/SetupPage'));
const PrintPage = lazy(() => import('./pages/PrintPage'));
const ControlPage = lazy(() => import('./pages/ControlPage'));
const DisplayPage = lazy(() => import('./pages/DisplayPage'));

function Themed({ children }: { children: ReactNode }) {
  const game = useGame();
  useTheme(game?.settings.themeId);
  return <>{children}</>;
}

function Page({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="page center-page">{t.common.loading}</div>}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export function App() {
  useEffect(() => {
    checkStorageHealth();
  }, []);
  return (
    <BrowserRouter>
      <StorageBanner />
      <Routes>
        <Route path="/" element={<Themed><Page><LibraryPage /></Page></Themed>} />
        <Route path="/setup" element={<Themed><Page><SetupPage /></Page></Themed>} />
        <Route path="/print" element={<Themed><Page><PrintPage /></Page></Themed>} />
        <Route path="/control" element={<Themed><Page><ControlPage /></Page></Themed>} />
        {/* Display manages its own theme from the public state */}
        <Route path="/display" element={<Page><DisplayPage /></Page>} />
        <Route path="*" element={<Themed><Page><LibraryPage /></Page></Themed>} />
      </Routes>
    </BrowserRouter>
  );
}
