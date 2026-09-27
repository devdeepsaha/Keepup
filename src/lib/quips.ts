import { useCallback, useEffect, useRef, useState } from 'react';

// Things Bouncy mutters in its thought bubble, depending on what you're doing.

// While you type (every ~5 s of typing).
const TYPING = [
  'Ooh, go on…',
  'Typing up a storm.',
  'I see you.',
  'Keep going, I’m hooked.',
  'Big update energy.',
  'Mhm, mhm…',
  'Is this about a client?',
  'Taking notes. Mentally.',
  'This is getting good.',
  'Fingers on fire.',
];
// You paused briefly (1.2 s).
const PONDER = [
  'Hmm, go on…',
  'Interesting…',
  "I'm listening.",
  'Take your time.',
  'Ooh, a client update?',
  'Noted. Probably.',
  'Thinking thoughts…',
  'And then…?',
  'Lost for words?',
  'I can wait. Briefly.',
];
// Still paused (from 4 s, a new one every 5 s).
const IMPATIENT = [
  'Hello? Still there?',
  "We're waiting… type, dude.",
  "Just hit enter, it's fine.",
  "I won't judge the typos.",
  'The suspense is killing me.',
  'Did you fall asleep?',
  'Tick… tock…',
  'Enter is the big button.',
  'I’ve aged a year.',
  'Should I make tea?',
];
// A long message, or a long time typing.
const LONG = [
  'Will you ever stop typing?',
  'This is basically an essay.',
  'Wow, a whole novel.',
  'Save some words for the client!',
  "I'll need a coffee for this one.",
  'Chapter two already?',
  'Do I get a summary?',
];
// While it's answering (from 0.8 s, a new one every 2.5 s).
const THINKING = [
  'Crunching your tasks…',
  'Asking my brain cells…',
  'Checking the calendar…',
  'Doing the maths…',
  'One sec, being clever…',
  'Reading your logs…',
  'Consulting the rhythm…',
  'Almost there…',
];
// Box empty, panel open (from 10 s, a new one every 8 s).
const IDLE = [
  'Psst. Anything to log?',
  'Who did you update today?',
  'Bored. Tell me something.',
  'Any client wins today?',
  'I’m right here, you know.',
  'Ask me what’s left?',
];

export const QUIPS = { TYPING, PONDER, IMPATIENT, LONG, THINKING, IDLE };

function pick(list: string[], last: string | null) {
  const options = list.length > 1 ? list.filter((q) => q !== last) : list;
  return options[Math.floor(Math.random() * options.length)];
}

// The remark to show in Bouncy's thought bubble right now, or null for the plain "…" dots.
export function useBouncyQuip(text: string, pending: boolean, open: boolean) {
  const [quip, setQuip] = useState<string | null>(null);
  const last = useRef<string | null>(null);
  const typingSince = useRef<number | null>(null);
  const holdUntil = useRef(0); // a remark made mid-typing stays up a moment even as you keep typing
  const lastSaid = useRef(0);
  const lastLong = useRef(0);

  const say = useCallback((list: string[], holdMs = 0) => {
    const q = pick(list, last.current);
    last.current = q;
    holdUntil.current = Date.now() + holdMs;
    lastSaid.current = Date.now();
    setQuip(q);
  }, []);

  useEffect(() => {
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const every = (ms: number, fn: () => void) => timers.push(window.setInterval(fn, ms));
    const now = Date.now();
    const hasText = text.trim().length > 0;
    if (!hasText) typingSince.current = null;
    else if (typingSince.current === null) typingSince.current = now;

    if (pending) {
      setQuip(null);
      later(800, () => say(THINKING));
      every(2500, () => say(THINKING));
    } else if (hasText) {
      const typedFor = now - (typingSince.current ?? now);
      const long = text.length > 120 || typedFor > 15_000;
      if (long && now - lastLong.current > 8000) {
        // A cheeky remark about the length, at most every 8 seconds.
        lastLong.current = now;
        say(LONG, 3000);
      } else if (typedFor > 2500 && now - lastSaid.current > 5000) {
        // Chatter while you type: roughly every 5 seconds.
        say(TYPING, 2500);
      } else if (now > holdUntil.current) setQuip(null);
      // Paused: a thought straight away, then impatience that keeps coming.
      later(1200, () => say(PONDER));
      later(4000, () => {
        say(IMPATIENT);
        every(5000, () => say(IMPATIENT));
      });
    } else {
      setQuip(null);
      if (open) {
        later(10_000, () => {
          say(IDLE);
          later(4000, () => setQuip(null));
          every(8000, () => {
            say(IDLE);
            later(4000, () => setQuip(null));
          });
        });
      }
    }
    return () =>
      timers.forEach((t) => {
        window.clearTimeout(t);
        window.clearInterval(t);
      });
  }, [text, pending, open, say]);

  return quip;
}
