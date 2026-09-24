import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import type { Workspace } from '../types';

// A colour per client (by @tag key). Picked colours are saved; the rest get a stable automatic one.
// Red, amber and green are left out: they mean urgency elsewhere in the app.
export const CLIENT_PALETTE = [
  '#257ef4', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f97316', // orange
  '#14b8a6', // teal
  '#6366f1', // indigo
  '#06b6d4', // cyan
  '#a855f7', // purple
  '#f43f5e', // rose
  '#84cc16', // lime
] as const;

export function autoColor(key: string) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CLIENT_PALETTE[h % CLIENT_PALETTE.length];
}

interface ClientColors {
  colorOf: (key: string) => string;
  isCustom: (key: string) => boolean;
  setColor: (key: string, color: string | null) => void; // null → back to automatic
}

const Ctx = createContext<ClientColors>({ colorOf: autoColor, isCustom: () => false, setColor: () => {} });

export function ClientColorsProvider({ workspace, children }: { workspace: Workspace; children: ReactNode }) {
  const [custom, setCustom] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let live = true;
    setCustom(new Map());
    supabase
      .from('client_colors')
      .select('key, color')
      .eq('workspace', workspace)
      .then(({ data }) => {
        if (live && data) setCustom(new Map(data.map((r) => [r.key as string, r.color as string])));
      });
    return () => {
      live = false;
    };
  }, [workspace]);

  const setColor = useCallback(
    (key: string, color: string | null) => {
      setCustom((prev) => {
        const next = new Map(prev);
        if (color) next.set(key, color);
        else next.delete(key);
        return next;
      });
      if (color) supabase.from('client_colors').upsert({ workspace, key, color, updated_at: new Date().toISOString() }).then(() => {});
      else supabase.from('client_colors').delete().eq('workspace', workspace).eq('key', key).then(() => {});
    },
    [workspace],
  );

  const colorOf = useCallback((key: string) => custom.get(key) ?? autoColor(key), [custom]);
  const isCustom = useCallback((key: string) => custom.has(key), [custom]);

  return <Ctx.Provider value={{ colorOf, isCustom, setColor }}>{children}</Ctx.Provider>;
}

export const useClientColors = () => useContext(Ctx);

// Swatches for picking a client's colour, plus "Auto".
export function ColorSwatches({ clientKey, onPicked }: { clientKey: string; onPicked?: () => void }) {
  const { colorOf, isCustom, setColor } = useClientColors();
  const current = colorOf(clientKey);
  return (
    <div className="px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between font-display text-[0.6875rem] text-[var(--text-muted)]">
        <span>Client colour</span>
        {isCustom(clientKey) && (
          <button
            onClick={() => {
              setColor(clientKey, null);
              onPicked?.();
            }}
            className="hover:text-[var(--text-main)] cursor-pointer"
          >
            Auto
          </button>
        )}
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {CLIENT_PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => {
              setColor(clientKey, c);
              onPicked?.();
            }}
            aria-label={`Use ${c}`}
            aria-pressed={current === c}
            style={{ background: c }}
            className={`h-6 w-full rounded-md transition-transform hover:scale-110 cursor-pointer ${
              current === c ? 'ring-2 ring-offset-2 ring-[var(--text-main)] ring-offset-[var(--surface)]' : ''
            }`}
          />
        ))}
      </div>
    </div>
  );
}
