import { useCallback, useEffect, useRef, useState } from 'react';

// Things Bouncy mutters in its thought bubble, depending on what you're doing.
const PONDER = [
  'Hmm, go on…',
  'Interesting…',
  "I'm listening.",
  'Take your time.',
  'Ooh, a client update?',
  'Noted. Probably.',
  'Thinking thoughts…',
];
const IMPATIENT = [
  'Hello? Still there?',
  "We're waiting… type, dude.",
  "Just hit enter, it's fine.",
  "I won't judge the typos.",
  'The suspense is killing me.',
  'Did you fall asleep?',
];
const LONG = [
  'Will you ever stop typing?',
  'This is basically an essay.',
  'Wow, a whole novel.',
  'Save some words for the client!',
  "I'll need a coffee for this one.",
];
const THINKING = ['Crunching your tasks…', 'Asking my brain cells…', 'Checking the calendar…', 'Doing the maths…', 'One sec, being clever…'];
const IDLE = ['Psst. Anything to log?', 'Who did you update today?', 'Bored. Tell me something.'];

function pick(list: string[], last: string | null) {
  const options = list.length > 1 ? list.filter((q) => q !== last) : list;
  return options[Math.floor(Math.random() * options.length)];
}

// The remark to show in Bouncy's thought bubble right now, or null for the plain "…" dots.
export function useBouncyQuip(text: string, pending: boolean, open: boolean) {
  const [quip, setQuip] = useState<string | null>(null);
  const last = useRef<string | null>(null);
  const typingSince = useRef<number | null>(null);
  const holdUntil = useRef(0); // a remark made mid-typing stays up a moment
  const lastLong = useRef(0);

  const say = useCallback((list: string[], holdMs = 0) => {
    const q = pick(list, last.current);
    last.current = q;
    holdUntil.current = Date.now() + holdMs;
    setQuip(q);
  }, []);

  useEffect(() => {
    const timers: number[] = [];
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const now = Date.now();
    const hasText = text.trim().length > 0;
    if (!hasText) typingSince.current = null;
    else if (typingSince.current === null) typingSince.current = now;

    if (pending) {
      setQuip(null);
      later(1500, () => say(THINKING));
      timers.push(window.setInterval(() => say(THINKING), 4000));
    } else if (hasText) {
      // A long message or a long time typing: a cheeky remark, at most every 15 seconds.
      const long = text.length > 180 || now - (typingSince.current ?? now) > 25_000;
      if (long && now - lastLong.current > 15_000) {
        lastLong.current = now;
        say(LONG, 3500);
      } else if (now > holdUntil.current) setQuip(null);
      // Paused: sometimes a thought, then impatience.
      later(2200, () => (Math.random() < 0.6 ? say(PONDER) : setQuip(null)));
      later(7000, () => say(IMPATIENT));
      later(16_000, () => say(IMPATIENT));
    } else {
      setQuip(null);
      if (open) {
        later(20_000, () => say(IDLE));
        later(26_000, () => setQuip(null));
      }
    }
    return () => timers.forEach((t) => {
      window.clearTimeout(t);
      window.clearInterval(t);
    });
  }, [text, pending, open, say]);

  return quip;
}
