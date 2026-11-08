// Regression: the Display must never receive unrevealed winners (card numbers / codes), at any point.
import { describe, expect, it } from 'vitest';
import { buildAttemptMap, checkCode, formatCardNo } from '../core/cards';
import { defaultConfig, gameReducer, newGame, type GameAction, type GameRecord } from '../core/game';
import { maskCells } from '../core/patterns';
import { seededRng, shuffle } from '../core/rng';
import { allBalls } from '../core/symbols';
import { Engine } from '../core/winners';
import { buildPublicState, withoutTransient, type LiveState, type PublicCard, type PublicState } from './publicState';

const T = (a: GameAction, now = 1) => ({ ...a, now });

function setup(): { g: GameRecord; engine: Engine } {
  const cfg = {
    ...defaultConfig(),
    cardCount: 600,
    rounds: [
      { id: 'a', name: 'R1', prize: 'P1', winnersWanted: 3, patternIds: ['anyLine'] },
      { id: 'b', name: 'R2', prize: 'P2', winnersWanted: 2, patternIds: ['x'] },
      { id: 'c', name: 'R3', prize: 'P3', winnersWanted: 1, patternIds: ['blackout'] },
    ],
  };
  let g = newGame(0, cfg);
  g = gameReducer(g, T({ type: 'GENERATE', seed: 'leak-test', attempts: buildAttemptMap(cfg, 'leak-test') }));
  return { g, engine: new Engine(g.config, g.seed!, g.attempts) };
}

function card(engine: Engine, g: GameRecord, no: number, round: number): PublicCard {
  const st = engine.cardStatus(no, g.draws, round);
  return { no, cells: st.card!.cells, win: st.mask ? maskCells(st.mask) : [] };
}

/** Every card number the Display can see, with where it appears */
function visibleCards(ps: PublicState): { round: number | null; no: number }[] {
  const out: { round: number | null; no: number }[] = [];
  ps.hall.forEach((h) => h.cards.forEach((no) => out.push({ round: h.round, no })));
  ps.reveal?.cards.forEach((c) => out.push({ round: ps.reveal!.round, no: c.no }));
  if (ps.showCard) out.push({ round: null, no: ps.showCard.card.no });
  return out;
}

function assertNoLeak(g: GameRecord, ps: PublicState, where: string) {
  const json = JSON.stringify(ps);
  // no check code of ANY card ever goes to the Display
  for (const w of g.winners) expect(json, `${where}: code of #${w.cardNo}`).not.toContain(checkCode(g.seed!, w.cardNo));
  const hidden = g.winners.filter((w) => !w.revealed);
  for (const v of visibleCards(ps)) {
    const leak = hidden.find((w) => w.cardNo === v.no && (v.round === null || v.round === w.round));
    expect(leak, `${where}: unrevealed winner #${v.no} visible`).toBeUndefined();
  }
  for (const w of hidden) {
    expect(json, `${where}: formatted #${w.cardNo}`).not.toContain(formatCardNo(w.cardNo));
  }
}

describe('public state never leaks unrevealed winners', () => {
  it('holds through a full 3-round game, including mid-reveal and buggy live state', () => {
    let { g, engine } = setup();
    const order = shuffle(allBalls(g.config), seededRng('order'));
    let live: LiveState = { reveal: null, showCard: null, rulesOpen: false };
    let checks = 0;
    const rng = seededRng('host');

    const check = (where: string) => {
      // 1) the real live state
      assertNoLeak(g, buildPublicState(g, engine, live), where);
      // 2) a buggy/hostile live state that tries to push every winner (revealed or not) to the TV
      const all = g.winners.map((w) => card(engine, g, w.cardNo, w.round));
      const pending = g.winners.filter((w) => !w.revealed);
      const evil: LiveState = {
        reveal: all.length ? { seq: 1, round: g.currentRound, roundName: 'x', prize: 'y', cards: all } : null,
        showCard: pending.length ? { seq: 2, card: card(engine, g, pending[0].cardNo, pending[0].round), status: 'win', ok: true } : null,
        rulesOpen: false,
      };
      assertNoLeak(g, buildPublicState(g, engine, evil), where + ' (evil live)');
      checks += 2;
    };

    for (let d = 0; d < order.length && g.status !== 'finished'; d++) {
      const res = engine.evaluate([...g.draws, order[d]], g.currentRound, g.winners);
      g = gameReducer(g, T({ type: 'DRAW', ball: order[d], winners: res.newWinners }));
      // Control keeps a stale reveal overlay up across this draw sometimes (mid-reveal + new winners)
      if (rng() < 0.5) live = { ...live, reveal: null };
      check(`after draw ${d + 1}`);

      const pending = g.winners.filter((w) => w.round === g.currentRound && !w.revealed);
      // host sometimes waits ("Not yet"), sometimes reveals only some winners
      if (pending.length && rng() < 0.6) {
        const some = pending.slice(0, Math.max(1, Math.floor(pending.length * rng())));
        g = gameReducer(g, T({ type: 'REVEAL', round: g.currentRound, cardNos: some.map((w) => w.cardNo) }));
        live = { ...live, reveal: { seq: d, round: g.currentRound, roundName: 'r', prize: 'p', cards: some.map((w) => card(engine, g, w.cardNo, w.round)) } };
        check(`mid-reveal at draw ${d + 1}`);
      }
      const want = g.config.rounds[g.currentRound].winnersWanted;
      if (g.winners.filter((w) => w.round === g.currentRound).length >= want) {
        if (g.currentRound === g.config.rounds.length - 1) g = gameReducer(g, T({ type: 'END_GAME' }));
        else {
          const next = engine.evaluate(g.draws, g.currentRound + 1, g.winners);
          g = gameReducer(g, T({ type: 'NEXT_ROUND', winners: next.newWinners }));
          check(`round ${g.currentRound + 1} start`);
        }
      }
    }
    expect(g.winners.length).toBeGreaterThanOrEqual(6);
    expect(g.winners.some((w) => !w.revealed)).toBe(true); // we really tested hidden winners
    expect(checks).toBeGreaterThan(100);
  });

  it('a Control refresh mid-reveal yields a clean snapshot; stored state never carries overlays', () => {
    let { g, engine } = setup();
    const order = shuffle(allBalls(g.config), seededRng('o2'));
    for (let d = 0; g.winners.length === 0; d++) {
      const res = engine.evaluate([...g.draws, order[d]], 0, g.winners);
      g = gameReducer(g, T({ type: 'DRAW', ball: order[d], winners: res.newWinners }));
    }
    const nos = g.winners.map((w) => w.cardNo);
    g = gameReducer(g, T({ type: 'REVEAL', round: 0, cardNos: nos }));
    const mid = buildPublicState(g, engine, { reveal: { seq: 1, round: 0, roundName: 'r', prize: 'p', cards: nos.map((n) => card(engine, g, n, 0)) }, showCard: null, rulesOpen: true });
    expect(mid.reveal?.cards.length).toBe(nos.length);
    // after a refresh Control starts with empty live state -> Display drops the overlay, board shows
    const fresh = buildPublicState(g, engine, { reveal: null, showCard: null, rulesOpen: false });
    expect(fresh.reveal).toBeNull();
    expect(fresh.showCard).toBeNull();
    expect(fresh.draws).toEqual(mid.draws);
    expect(fresh.hall[0].cards.sort()).toEqual(nos.slice().sort()); // revealed winners stay in the hall
    // storage fallback copy never contains the overlay
    const stored = withoutTransient(mid);
    expect(stored.reveal).toBeNull();
    expect(stored.rulesOpen).toBe(false);
  });
});
