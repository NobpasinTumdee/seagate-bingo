import { useEffect } from 'react';
import { blackGold } from './blackGold';
import { seagate } from './seagate';
import type { Theme } from './types';

export type { Theme, PrintPalette } from './types';

/** Add a new theme: create a file exporting a Theme object and add it here. */
export const THEMES: Theme[] = [seagate, blackGold];

export function getTheme(id?: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function applyTheme(theme: Theme, el: HTMLElement = document.documentElement) {
  for (const [k, v] of Object.entries(theme.vars)) el.style.setProperty('--' + k, v);
  el.style.setProperty('--heading-font', theme.headingFont);
  el.style.setProperty('--body-font', theme.bodyFont);
  el.dataset.theme = theme.id;
  el.dataset.ball = theme.ball;
  el.dataset.decor = theme.decor;
}

export function useTheme(id?: string): Theme {
  const theme = getTheme(id);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return theme;
}
