import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { migrateAllGames } from './state/cardSet';
import './styles/fonts.css';
import './styles/app.css';
import './styles/card.css';
import './styles/display.css';
import './styles/control.css';
import './styles/print.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Freeze games generated before card snapshots existed (v1 generator, this machine). Not on the TV window.
if (!location.pathname.startsWith('/display')) {
  migrateAllGames().catch((e) => console.error('[bingo] card snapshot migration failed', e));
}
