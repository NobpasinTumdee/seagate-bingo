import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
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
