import { clueFor, close, type ChainCard, type Game } from './telephone';

/**
 * Celebratory, factual captions for the reveal. Built only from text the game
 * knows (the word, the guesses, the static it applied). They never claim to
 * know what a drawing shows.
 */

/** Shown exactly as written when static changed a text clue (R3.4). */
export const STATIC_TEXT_NOTE = 'Draw whatever this makes you imagine—even if it’s nonsense.';
/** The same, when static changed a drawing. */
export const STATIC_DRAWING_NOTE = 'Guess whatever this makes you imagine—even if it’s nonsense.';

/** Host setup: how everyone gets one scoring chance per round (R7.3). */
export function fairNote(players: number, mode: 'quick' | 'match'): string {
  const base =
    players % 2 === 0
      ? `With ${players} players, every drawing is guessed by the next player, so each player gets one chance to score per round.`
      : `With ${players} players, the last drawing has no guesser, so the whole room guesses it out loud before the reveal. Each player still gets one chance to score per round.`;
  return mode === 'match' ? `${base} The first drawer moves one seat each round.` : base;
}

const q = (t: string) => `“${t.toUpperCase()}”`;

export function captionFor(g: Game, card: ChainCard): string {
  const last = card.step === g.players;
  switch (card.kind) {
    case 'word':
      return `The secret word, picked by ${card.name}.`;
    case 'missing':
      return `This phone missed hop ${card.step}. Ask for it by sound below.`;
    case 'drawing': {
      let s = card.clue ? `${card.name} was asked to draw ${q(card.clue)}.` : `${card.name} drew this.`;
      if (card.arrived) s += ` Static changed ${card.arrived.flipped.length} squares on the way.`;
      if (last) s += ' The last hop!';
      return s;
    }
    case 'text': {
      const clue = clueFor(g, card.step - 1);
      const text = card.text ?? '';
      let s: string;
      if (!clue) s = `${card.name} guessed ${q(text)}.`;
      else if (close(text, clue)) s = `✓ Still ${q(clue)}: ${card.name} got it!`;
      else s = `${q(clue)} became ${q(text)}!`;
      if (last && clue && !close(text, clue)) s += ' Your message took an unexpected turn.';
      if (card.arrived?.text) s += ` Then static turned it into ${q(card.arrived.text)}.`;
      return s;
    }
  }
}
