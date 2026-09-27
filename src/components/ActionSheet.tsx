import { useEffect } from 'react';
import { createPortal } from 'react-dom';

// A menu that slides up from the bottom of the screen: what tap-and-hold opens on phones.

export interface SheetAction {
  label: string;
  icon: string; // SVG path
  onSelect: () => void;
  danger?: boolean;
}

interface Props {
  title: string;
  subtitle?: string;
  actions: SheetAction[];
  onClose: () => void;
}

export default function ActionSheet({ title, subtitle, actions, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-backdrop absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="sheet-panel absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-[var(--line-color)] bg-[var(--surface)] px-3 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--line-color)]" />
        <div className="mb-2 px-3">
          <div className="truncate font-display text-lg font-semibold">{title}</div>
          {subtitle && <div className="truncate text-xs text-[var(--text-muted)]">{subtitle}</div>}
        </div>
        <div className="flex flex-col">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => {
                onClose();
                a.onSelect();
              }}
              className={`flex items-center gap-3.5 rounded-xl px-3 py-3.5 text-left text-[0.9375rem] active:bg-[var(--bg-color)] cursor-pointer ${
                a.danger ? 'text-red-500' : ''
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0 opacity-80">
                <path d={a.icon} />
              </svg>
              {a.label}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-1 w-full rounded-xl bg-[var(--bg-color)] py-3.5 font-display text-sm font-semibold cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}

export const SHEET_ICONS = {
  log: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  done: 'M5 12l5 5 9-10',
  edit: 'M4 6h16M4 12h10M4 18h7',
  ask: 'M12 3l1.8 4.9L19 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5 9.7l5.2-1.8z',
  open: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  archive: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  hold: 'M10 4H6v16h4zM18 4h-4v16h4z',
};
