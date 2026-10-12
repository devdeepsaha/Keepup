import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

// The company (Mint-more): who's in it, their roles, and whose shared Mint-more work you can see.
// The database enforces all of this (015_org_policies.sql); this only mirrors it for the screens.

export type Role = 'admin' | 'founder' | 'manager' | 'member';
export type Level = 'view' | 'plan';

export interface Member {
  user_id: string;
  display_name: string | null;
  roles: Role[];
  status: 'invited' | 'active' | 'removed';
  invited_by: string | null;
  created_at: string;
}

export interface AccessRow {
  viewer_id: string;
  subject_id: string;
  level: Level;
  granted_by: string | null;
  created_at: string;
}

export interface Person {
  member: Member;
  level: Level; // what you can do with their Mint-more work
}

interface OrgValue {
  ready: boolean;
  me: Member | null;
  members: Member[];
  access: AccessRow[]; // the rows you're allowed to read
  people: Person[]; // colleagues whose Mint-more work you can see
  isAdmin: boolean;
  isFounder: boolean;
  isManager: boolean;
  nameOf: (id: string | null | undefined) => string;
  levelFor: (id: string) => Level | null;
  refresh: () => Promise<void>;
  setMyName: (name: string) => Promise<string | null>; // error message, or null
}

const Ctx = createContext<OrgValue | null>(null);

export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', founder: 'Founder', manager: 'Manager', member: 'Member' };

// "devdeep120205@gmail.com" → "Devdeep": a stand-in until someone sets their name.
export const nameFromEmail = (email: string) =>
  email
    .split('@')[0]
    .replace(/[0-9._-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase()) || 'You';

export function OrgProvider({ user, children }: { user: User; children: ReactNode }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [m, a] = await Promise.all([
      supabase.from('members').select('user_id, display_name, roles, status, invited_by, created_at').order('created_at'),
      supabase.from('access').select('viewer_id, subject_id, level, granted_by, created_at'),
    ]);
    if (m.data) setMembers(m.data as Member[]);
    if (a.data) setAccess(a.data as AccessRow[]);
  }, []);

  // Signing in marks an invite as accepted and saves the name given at sign-up (or in the invite).
  useEffect(() => {
    const fromSignup = (user.user_metadata?.display_name as string | undefined) ?? null;
    supabase.rpc('org_hello', { p_name: fromSignup }).then(() => refresh().then(() => setReady(true)));
    const channel = supabase
      .channel(`org-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'access' }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user.id, user.user_metadata, refresh]);

  const value = useMemo<OrgValue>(() => {
    const me = members.find((m) => m.user_id === user.id) ?? null;
    const active = me?.status === 'active';
    const has = (r: Role) => active && !!me?.roles.includes(r);
    const isAdmin = has('admin');
    const byId = new Map(members.map((m) => [m.user_id, m]));
    let people: Person[];
    if (isAdmin) {
      people = members.filter((m) => m.user_id !== user.id).map((member) => ({ member, level: 'plan' as Level }));
    } else if (active) {
      people = access
        .filter((a) => a.viewer_id === user.id && byId.has(a.subject_id))
        .map((a) => ({ member: byId.get(a.subject_id)!, level: a.level }));
    } else people = [];
    people.sort((a, b) => (a.member.display_name ?? '').localeCompare(b.member.display_name ?? ''));
    const levels = new Map(people.map((p) => [p.member.user_id, p.level]));
    return {
      ready,
      me,
      members,
      access,
      people,
      isAdmin,
      isFounder: has('founder'),
      isManager: has('manager'),
      nameOf: (id) => {
        if (!id) return 'Someone';
        if (id === user.id) return 'You';
        return byId.get(id)?.display_name || 'A colleague';
      },
      levelFor: (id) => levels.get(id) ?? null,
      refresh,
      setMyName: async (name: string) => {
        const clean = name.replace(/\s+/g, ' ').trim();
        if (!clean) return 'Add your name';
        const { error } = await supabase.rpc('org_hello', { p_name: clean });
        if (error) return error.message;
        await refresh();
        return null;
      },
    };
  }, [members, access, ready, user.id, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Outside a provider (e.g. a preview), behave like a company of one.
const SOLO: OrgValue = {
  ready: true,
  me: null,
  members: [],
  access: [],
  people: [],
  isAdmin: false,
  isFounder: false,
  isManager: false,
  nameOf: (id) => (id ? 'A colleague' : 'Someone'),
  levelFor: () => null,
  refresh: async () => {},
  setMyName: async () => null,
};

export const useOrg = () => useContext(Ctx) ?? SOLO;

// Calls the org server function (invites, removing and restoring people).
export async function orgAction(body: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>('org', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const detail = ctx ? await ctx.json().catch(() => null) : null;
    return (detail as { error?: string } | null)?.error ?? error.message;
  }
  return data?.error ?? null;
}
