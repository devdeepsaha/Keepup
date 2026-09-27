import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import type { Space } from '../types';

// Spaces: the built-in Mint-more ("agency") and Personal, plus any you create. "Work" spaces have clients,
// check-in rhythms and client updates; "personal" ones are plain to-do lists.

export const BUILTIN_SPACES: Space[] = [
  { key: 'agency', name: 'Mint-more', kind: 'work', color: '#257ef4', position: 0, builtin: true },
  { key: 'personal', name: 'Personal', kind: 'personal', color: '#14b8a6', position: 1, builtin: true },
];

export const SPACE_COLORS = ['#257ef4', '#14b8a6', '#8b5cf6', '#ec4899', '#f97316', '#6366f1', '#06b6d4', '#84cc16'];

const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'space';

interface SpacesValue {
  spaces: Space[];
  spaceOf: (key: string) => Space;
  createSpace: (name: string, kind: Space['kind']) => Promise<string>; // the new space's key
}

const Ctx = createContext<SpacesValue>({
  spaces: BUILTIN_SPACES,
  spaceOf: (key) => BUILTIN_SPACES.find((s) => s.key === key) ?? BUILTIN_SPACES[0],
  createSpace: async () => 'agency',
});

export function SpacesProvider({ children }: { children: ReactNode }) {
  const [custom, setCustom] = useState<Space[]>([]);

  useEffect(() => {
    supabase
      .from('spaces')
      .select('key, name, kind, color, position')
      .order('position')
      .then(({ data }) => {
        if (data) setCustom(data as Space[]);
      });
  }, []);

  // Built-ins first (a saved row with the same key renames one), then yours in the order you made them.
  const spaces = useMemo(() => {
    const byKey = new Map(custom.map((s) => [s.key, s]));
    const builtins = BUILTIN_SPACES.map((b) => ({ ...b, ...(byKey.get(b.key) ?? {}), builtin: true }));
    const mine = custom.filter((s) => !BUILTIN_SPACES.some((b) => b.key === s.key)).sort((a, b) => a.position - b.position);
    return [...builtins, ...mine];
  }, [custom]);

  const spaceOf = useCallback(
    (key: string) =>
      spaces.find((s) => s.key === key) ?? { key, name: key, kind: 'work' as const, color: '#257ef4', position: 99 },
    [spaces],
  );

  const createSpace = useCallback(
    async (name: string, kind: Space['kind']) => {
      const clean = name.replace(/\s+/g, ' ').trim().slice(0, 40);
      const base = slug(clean);
      let key = base.length >= 2 ? base : `${base}-space`;
      for (let n = 2; spaces.some((s) => s.key === key); n++) key = `${base}-${n}`;
      const color = SPACE_COLORS[(spaces.length + 2) % SPACE_COLORS.length];
      const space: Space = { key, name: clean, kind, color, position: spaces.length };
      setCustom((prev) => [...prev, space]);
      const { error } = await supabase.from('spaces').insert({ key, name: clean, kind, color, position: space.position });
      if (error) {
        setCustom((prev) => prev.filter((s) => s.key !== key));
        throw new Error(error.message);
      }
      return key;
    },
    [spaces],
  );

  return <Ctx.Provider value={{ spaces, spaceOf, createSpace }}>{children}</Ctx.Provider>;
}

export const useSpaces = () => useContext(Ctx);

// Gradient stops for a space's logo ring: its colour fading into a lighter partner.
export function spaceGradient(space: Space): string[] {
  if (space.key === 'agency') return ['#257ef4', '#06b6d4', '#10b981', '#22c55e'];
  if (space.key === 'personal') return ['#14b8a6', '#22c55e', '#84cc16', '#a3e635'];
  const hex = space.color.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mix = (t: number) =>
    `#${[r, g, b].map((c) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0')).join('')}`;
  return [space.color, mix(0.25), mix(0.5)];
}
