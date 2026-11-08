// Shared domain types (pure, no React)

export type CardSize = 3 | 4 | 5 | 6;
export type SymbolMode = 'number' | 'columnLogo' | 'image';

export type SymbolItem = {
  id: string;
  label: string;
  /** url (e.g. /assets/...) or `idb:<key>` for images stored in IndexedDB */
  image?: string;
  /** optional text for the Thai voice call-out (e.g. "ไอรอนวูล์ฟ") */
  speech?: string;
};

export type SymbolSet = {
  id: string;
  name: string;
  mode: SymbolMode;
  columns?: SymbolItem[];
  items?: SymbolItem[];
  builtIn?: boolean;
};

export type PatternDef = {
  id: string;
  name: string;
  /** for custom patterns: cell indices (row-major) for a given size */
  size?: CardSize;
  cells?: number[];
};

export type Round = {
  id: string;
  name: string;
  prize: string;
  winnersWanted: number;
  patternIds: string[];
};

export type GameConfig = {
  eventName: string;
  eventLogo?: string;
  eventDate?: string;
  size: CardSize;
  mode: SymbolMode;
  symbolSetId: string;
  /** snapshot of column header symbols (columnLogo mode), length === size */
  columns: SymbolItem[];
  /** snapshot of image items (image mode); ball value v maps to items[v-1] */
  items: SymbolItem[];
  poolMin: number;
  poolMax: number;
  freeCenter: boolean;
  rounds: Round[];
  allowRepeatWinners: boolean;
  cardCount: number;
  startNumber: number;
  rules: string;
  customPatterns: PatternDef[];
};

/** A card: row-major cells, 0 = free cell, otherwise ball value */
export type Card = { no: number; cells: number[] };

export type Winner = {
  round: number;
  cardNo: number;
  /** number of draws at the moment the card won (1-based) */
  atDraw: number;
  revealed: boolean;
  time: number;
};

export type LogEntry = { t: number; type: string; detail: string };
