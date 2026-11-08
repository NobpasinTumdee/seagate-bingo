// Card checker logic
import { checkCode, isValidCardNo, normalizeCode } from './cards';
import type { GameRecord } from './game';
import type { Mask } from './patterns';
import { maskCells } from './patterns';
import type { Card } from './types';
import type { Engine } from './winners';

export type CheckStatus = 'win' | 'pending' | 'forged' | 'wonEarlier' | 'notFound';

export type CheckResult = {
  status: CheckStatus;
  cardNo: number;
  card?: Card;
  missing?: number;
  winCells?: number[];
  earlierRound?: number;
  codeOk?: boolean;
};

/** Parse "123", "#0123", "0123 ABCD", "#0123-ABCD" */
export function parseCardInput(input: string): { no: number | null; code: string } {
  const m = input.trim().match(/^#?\s*(\d{1,5})\s*[-\s]?\s*([A-Za-z0-9]{0,4})?\s*$/);
  if (!m) return { no: null, code: '' };
  return { no: parseInt(m[1], 10), code: normalizeCode(m[2] ?? '') };
}

export function checkCard(g: GameRecord, engine: Engine, cardNo: number, code: string): CheckResult {
  if (!g.seed || !isValidCardNo(g.config, cardNo)) return { status: 'notFound', cardNo };
  const card = engine.cardByNo(cardNo);
  if (!card) return { status: 'notFound', cardNo };
  const codeNorm = normalizeCode(code);
  const codeOk = codeNorm.length === 0 ? undefined : codeNorm === checkCode(g.seed, cardNo);
  if (codeOk === false) return { status: 'forged', cardNo, card, codeOk };
  const st = engine.cardStatus(cardNo, g.draws, g.currentRound);
  const winCells = st.mask ? maskCells(st.mask as Mask) : undefined;
  const earlier = g.winners.find((w) => w.cardNo === cardNo && w.round < g.currentRound);
  if (earlier && !g.config.allowRepeatWinners)
    return { status: 'wonEarlier', cardNo, card, earlierRound: earlier.round, codeOk, winCells, missing: st.missing };
  if (st.missing === 0) return { status: 'win', cardNo, card, winCells, codeOk, missing: 0 };
  return { status: 'pending', cardNo, card, missing: st.missing, codeOk };
}
