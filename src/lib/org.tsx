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
  level: Level | 'none'; // 'none': an exception that hides this person
  granted_by: string | null;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  members: string[]; // user ids
}

// Broader rules for a founder or manager: "Everyone" and teams (person rows are the exceptions).
export interface TeamAccessRow {
  viewer_id: string;
  team_id: string;
  level: Level;
  granted_by: string | null;
}
export interface ScopeRow {
  viewer_id: string;
  level: Level;
  granted_by: string | null;
}

export interface Person {
  member: Member;
  level: Level; // what you can do with their Mint-more work
}

interface OrgValue {
  ready: boolean;
  me: Member | null;
  members: Member[];
  access: AccessRow[]; // the person rules you're allowed to read
  teams: Team[];
  teamAccess: TeamAccessRow[];
  scopes: ScopeRow[];
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
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamAccess, setTeamAccess] = useState<TeamAccessRow[]>([]);
  const [scopes, setScopes] = useState<ScopeRow[]>([]);
  // Who you can see, worked out by the database from every rule (Everyone, teams, exceptions).
  const [mine, setMine] = useState<{ user_id: string; level: Level }[]>([]);
  const [ready, setReady] = useState(false);
  // The admin also gets everyone's email, so people who haven't set a name yet still show as someone.
  const [emailNames, setEmailNames] = useState<Map<string, string>>(new Map());

  const refresh = useCallback(async () => {
    const [m, a, t, tm, ta, sc, my] = await Promise.all([
      supabase.from('members').select('user_id, display_name, roles, status, invited_by, created_at').order('created_at'),
      supabase.from('access').select('viewer_id, subject_id, level, granted_by, created_at'),
      supabase.from('teams').select('id, name').order('name'),
      supabase.from('team_members').select('team_id, user_id'),
      supabase.from('team_access').select('viewer_id, team_id, level, granted_by'),
      supabase.from('viewer_scope').select('viewer_id, level, granted_by'),
      supabase.rpc('org_my_people'),
    ]);
    if (m.data) setMembers(m.data as Member[]);
    if (a.data) setAccess(a.data as AccessRow[]);
    if (t.data) {
      const rows = (tm.data ?? []) as { team_id: string; user_id: string }[];
      setTeams((t.data as { id: string; name: string }[]).map((x) => ({ ...x, members: rows.filter((r) => r.team_id === x.id).map((r) => r.user_id) })));
    }
    if (ta.data) setTeamAccess(ta.data as TeamAccessRow[]);
    if (sc.data) setScopes(sc.data as ScopeRow[]);
    if (my.data) setMine(my.data as { user_id: string; level: Level }[]);
    // (Returns nothing for anyone but the admin.)
    const { data: emails } = await supabase.rpc('org_emails');
    if (emails) setEmailNames(new Map((emails as { user_id: string; email: string }[]).map((e) => [e.user_id, nameFromEmail(e.email)])));
  }, []);

  // Signing in marks an invite as accepted and saves the name given at sign-up (or in the invite).
  useEffect(() => {
    const fromSignup = (user.user_metadata?.display_name as string | undefined) ?? null;
    supabase.rpc('org_hello', { p_name: fromSignup }).then(() => refresh().then(() => setReady(true)));
    const channel = supabase
      .channel(`org-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'access' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_access' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'viewer_scope' }, () => refresh())
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
      people = mine.filter((p) => byId.has(p.user_id)).map((p) => ({ member: byId.get(p.user_id)!, level: p.level }));
    } else people = [];
    people.sort((a, b) => (a.member.display_name || emailNames.get(a.member.user_id) || '').localeCompare(b.member.display_name || emailNames.get(b.member.user_id) || ''));
    const levels = new Map(people.map((p) => [p.member.user_id, p.level]));
    return {
      ready,
      me,
      members,
      access,
      teams,
      teamAccess,
      scopes,
      people,
      isAdmin,
      isFounder: has('founder'),
      isManager: has('manager'),
      nameOf: (id) => {
        if (!id) return 'Someone';
        if (id === user.id) return 'You';
        return byId.get(id)?.display_name || emailNames.get(id) || 'A colleague';
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
  }, [members, access, teams, teamAccess, scopes, mine, ready, user.id, refresh, emailNames]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Outside a provider (e.g. a preview), behave like a company of one.
const SOLO: OrgValue = {
  ready: true,
  me: null,
  members: [],
  access: [],
  teams: [],
  teamAccess: [],
  scopes: [],
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
