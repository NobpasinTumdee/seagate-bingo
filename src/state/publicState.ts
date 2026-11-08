// The ONLY data the audience Display receives. Never put unrevealed winners here.
import type { AnimSpeed, GameRecord } from '../core/game';
import { compileRound, previewGrid } from '../core/patterns';
import { ballSpeech } from '../core/symbols';
import type { SymbolCfg } from '../components/Ball';
import type { Engine } from '../core/winners';

export type PublicCard = { no: number; cells: number[]; win: number[] };

export type RevealPayload = {
  seq: number;
  round: number;
  roundName: string;
  prize: string;
  cards: PublicCard[];
};

export type ShowCardPayload = { seq: number; card: PublicCard; status: string; ok: boolean };

export type LiveState = {
  reveal: RevealPayload | null;
  showCard: ShowCardPayload | null;
  rulesOpen: boolean;
};

export type PublicState = {
  v: 1;
  gameId: string;
  sentAt: number;
  themeId: string;
  eventName: string;
  eventLogo?: string;
  eventDate?: string;
  sym: SymbolCfg;
  rounds: { name: string; prize: string; patternName: string; cells: boolean[] }[];
  currentRound: number;
  draws: number[];
  /** speech text for the most recent ball (voice call-out) */
  lastSpeech: string;
  paused: boolean;
  finished: boolean;
  oneAway: number;
  twoAway: number;
  hall: { round: number; roundName: string; prize: string; cards: number[]; complete: boolean }[];
  rules: string;
  settings: { sound: boolean; volume: number; voice: boolean; speed: AnimSpeed };
} & LiveState;

/**
 * Defense in depth: whatever Control passes as live state, never let an unrevealed winner through.
 * - reveal: only cards whose winner entry for that round is already flagged `revealed`
 * - showCard: dropped entirely if the card is an unrevealed winner of any round
 */
export function sanitizeLive(g: GameRecord, live: LiveState): LiveState {
  const revealedKey = new Set(g.winners.filter((w) => w.revealed).map((w) => w.round + ':' + w.cardNo));
  const hiddenCards = new Set(g.winners.filter((w) => !w.revealed).map((w) => w.cardNo));
  let reveal = live.reveal;
  if (reveal) {
    const cards = reveal.cards.filter((c) => revealedKey.has(reveal!.round + ':' + c.no));
    reveal = cards.length ? { ...reveal, cards } : null;
  }
  const showCard = live.showCard && hiddenCards.has(live.showCard.card.no) ? null : live.showCard;
  return { reveal, showCard, rulesOpen: live.rulesOpen };
}

/** Transient overlays are never persisted / replayed from storage */
export function withoutTransient(ps: PublicState): PublicState {
  return { ...ps, reveal: null, showCard: null, rulesOpen: false };
}

export function buildPublicState(g: GameRecord, engine: Engine | null, rawLive: LiveState): PublicState {
  const cfg = g.config;
  const live = sanitizeLive(g, rawLive);
  const away = engine ? engine.evaluate(g.draws, g.currentRound, g.winners) : { oneAway: 0, twoAway: 0 };
  const roundComplete = (r: number) => g.winners.filter((w) => w.round === r).length >= (cfg.rounds[r]?.winnersWanted ?? 1);
  return {
    v: 1,
    gameId: g.id,
    sentAt: Date.now(),
    themeId: g.settings.themeId,
    eventName: cfg.eventName,
    eventLogo: cfg.eventLogo,
    eventDate: cfg.eventDate,
    sym: {
      mode: cfg.mode,
      size: cfg.size,
      poolMin: cfg.poolMin,
      poolMax: cfg.poolMax,
      columns: cfg.columns,
      items: cfg.items,
      freeCenter: cfg.freeCenter,
      eventLogo: cfg.eventLogo,
    },
    rounds: cfg.rounds.map((r) => {
      const p = compileRound(r.patternIds, cfg.size, cfg.customPatterns);
      return { name: r.name, prize: r.prize, patternName: p.name, cells: previewGrid(p, cfg.size) };
    }),
    currentRound: g.currentRound,
    draws: g.draws,
    lastSpeech: g.draws.length ? ballSpeech(cfg, g.draws[g.draws.length - 1]) : '',
    paused: g.paused,
    finished: g.status === 'finished',
    // the count is public, the card numbers are not
    oneAway: roundComplete(g.currentRound) ? 0 : away.oneAway,
    twoAway: roundComplete(g.currentRound) ? 0 : away.twoAway,
    hall: cfg.rounds
      .map((r, i) => ({
        round: i,
        roundName: r.name,
        prize: r.prize,
        cards: g.winners.filter((w) => w.round === i && w.revealed).map((w) => w.cardNo),
        complete: roundComplete(i),
      }))
      .filter((h) => h.cards.length > 0),
    rules: cfg.rules,
    settings: { sound: g.settings.sound, volume: g.settings.volume, voice: g.settings.voice, speed: g.settings.speed },
    reveal: live.reveal,
    showCard: live.showCard,
    rulesOpen: live.rulesOpen,
  };
}

export function animTiming(speed: AnimSpeed, reduced: boolean) {
  if (reduced) return { spin: 500, settle: 200, fly: 0, total: 900 };
  const spin = speed === 'fast' ? 2500 : speed === 'max' ? 4000 : 3200;
  const settle = 350;
  const fly = 750;
  return { spin, settle, fly, total: spin + settle + fly + 150 };
}

export function revealTiming(speed: AnimSpeed, reduced: boolean) {
  const k = reduced ? 0.35 : speed === 'fast' ? 0.7 : speed === 'max' ? 1.45 : 1;
  return { dim: 900 * k, roll: 2800 * k, boom: 1100 * k, card: 4200 * k };
}

export const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
