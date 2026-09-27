import { useRef } from 'react';

// Tap and hold (touch only): calls `onLongPress` with where the finger is after ~450ms, unless the finger
// moved (a scroll) or lifted first. The tap that follows a long press is swallowed, so it doesn't also open
// or toggle the thing underneath. Mouse users keep right-click and hover menus.
export function useLongPress(onLongPress: (x: number, y: number) => void, ms = 450) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      const { clientX, clientY } = e;
      timer.current = window.setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(12); // a small buzz, where supported
        onLongPress(clientX, clientY);
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // The browser's own long-press menu (copy / select) would fight ours.
    onContextMenu: (e: React.MouseEvent) => {
      if (fired.current || start.current) e.preventDefault();
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) {
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
      }
    },
  };
}
