import type { Personality } from './puzzles';

export type Moment = 'arrive' | 'solved' | 'wrong' | 'lastCandle' | 'rescued' | 'farewell' | 'faded' | 'hat';

export const PERSONALITY_INFO: Record<Personality, { label: string; icon: string }> = {
  shy: { label: 'Shy', icon: '🫣' },
  dramatic: { label: 'Dramatic', icon: '🎭' },
  mischievous: { label: 'Mischievous', icon: '😼' },
  sleepy: { label: 'Sleepy', icon: '💤' },
};

/** `{n}` is replaced with the ghost's name. Lines stay short so they never crowd the task. */
const LINES: Record<Personality, Record<Moment, string[]>> = {
  shy: {
    arrive: ['{n} peeks out from behind the doorframe.', '{n} gives a very brave little wave.'],
    solved: ['{n} does a tiny, quiet spin.', '{n} blushes a faint green.'],
    wrong: ['{n} hides behind the nearest curtain.', '{n} whispers, "That\'s okay… try again?"'],
    lastCandle: ['{n} cups the last candle in both hands.', '{n} protects the last candle.'],
    rescued: ['{n} can\'t stop smiling.'],
    farewell: ['{n} waves goodbye from very far away, and means it.'],
    faded: ['{n} whispers "thank you" as the light goes out.'],
    hat: ['{n} pulls the hat down over its eyes, delighted.'],
  },
  dramatic: {
    arrive: ['{n} swoops in with a ghastly "WOooOOO!"', '{n} bows to an audience of zero.'],
    solved: ['{n} declares this the greatest moment in ghost history.', '{n} faints with joy, then floats back up.'],
    wrong: ['{n} insists the door is broken.', '{n} gasps: "Betrayed by a key!"'],
    lastCandle: ['{n} clutches the last candle like a tragic hero.'],
    rescued: ['{n} demands a standing ovation.'],
    farewell: ['{n} exits stage left, sobbing magnificently.'],
    faded: ['{n} fades with one final, perfect pose.'],
    hat: ['{n} tips the hat to the crowd. Encore!'],
  },
  mischievous: {
    arrive: ['{n} has already rearranged the furniture.', '{n} grins like it knows a secret.'],
    solved: ['{n} cackles and does a loop-the-loop.', '{n} pockets a spare cobweb as a souvenir.'],
    wrong: ['{n} swears it wasn\'t its fault. It was a little bit its fault.', '{n} pretends that was on purpose.'],
    lastCandle: ['{n} stops giggling and guards the last candle.'],
    rescued: ['{n} high-fives the moon.'],
    farewell: ['{n} leaves a whoopee cushion behind. Goodbye!'],
    faded: ['{n} fades out mid-prank. Rude.'],
    hat: ['{n} wears the hat sideways. Of course.'],
  },
  sleepy: {
    arrive: ['{n} yawns and drifts in, half awake.', '{n} mumbles, "five more minutes…"'],
    solved: ['{n} gives a sleepy thumbs up.', '{n} snores, but approvingly.'],
    wrong: ['{n} wakes with a start. "Wha— did we get it?"', '{n} sighs and curls up a little.'],
    lastCandle: ['{n} stays wide awake to watch the last candle.'],
    rescued: ['{n} is finally, finally going to bed.'],
    farewell: ['{n} floats off toward the softest cloud. Goodnight.'],
    faded: ['{n} drifts into a very long nap.'],
    hat: ['{n} uses the hat as a pillow.'],
  },
};

/** Deterministic line: same ghost, same moment, same count → same words on every device. */
export function reaction(p: Personality, moment: Moment, name: string, salt = 0): string {
  const options = LINES[p][moment];
  return options[Math.abs(salt) % options.length].split('{n}').join(name);
}

export function allLines(): string[] {
  return Object.values(LINES).flatMap((m) => Object.values(m).flat());
}
