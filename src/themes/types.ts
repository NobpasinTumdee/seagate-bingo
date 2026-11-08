export type PrintPalette = {
  pageBg: string;
  cardBg: string;
  border: string;
  grid: string;
  headerBg: string;
  headerText: string;
  title: string;
  text: string;
  number: string;
  freeBg: string;
  freeText: string;
  accent: string;
  muted: string;
  /** line width multiplier for grid lines */
  lineWeight: number;
};

export type Theme = {
  id: string;
  name: string;
  /** optional company logo shown in headers */
  brandLogo?: string;
  headingFont: string;
  bodyFont: string;
  /** CSS custom properties, without leading `--` */
  vars: Record<string, string>;
  ball: 'platter' | 'gold';
  decor: 'circuit' | 'deco';
  print: { color: PrintPalette; ink: PrintPalette };
};
