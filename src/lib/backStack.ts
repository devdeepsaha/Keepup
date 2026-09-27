import { useEffect, useId, useRef } from 'react';

// The phone's back button (and the browser's) steps back through the app instead of leaving it:
// first it closes whatever is open on top (a menu, Bouncy, the drawer, an open task), then it returns to
// the previous page. Each open layer and each page change adds one history entry.

const layers: { id: string; close: () => void }[] = []; // open layers, newest last
let ignorePops = 0; // history.back() calls we made ourselves (a layer closed from the UI)
let onPageBack: ((state: unknown) => void) | null = null;

function onPop(e: PopStateEvent) {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  const top = layers.pop();
  if (top) top.close();
  else onPageBack?.(e.state);
}
if (typeof window !== 'undefined') window.addEventListener('popstate', onPop);

// While `open` is true, back closes it. Closing it any other way removes its history entry again.
export function useBackClose(open: boolean, close: () => void) {
  const id = useId();
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    history.pushState({ ...(history.state ?? {}), layer: id }, '');
    const entry = { id, close: () => closeRef.current() };
    layers.push(entry);
    return () => {
      const i = layers.indexOf(entry);
      if (i === -1) return; // closed by the back button: its entry is already gone
      layers.splice(i, 1);
      ignorePops++;
      history.back();
    };
  }, [open, id]);
}

// Pages: record a page change as a step back can return to.
export function pushPage(state: Record<string, unknown>) {
  history.pushState(state, '');
}
export function replacePage(state: Record<string, unknown>) {
  history.replaceState(state, '');
}
export function onPageChangeBack(handler: ((state: unknown) => void) | null) {
  onPageBack = handler;
}
