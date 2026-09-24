import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { attentionFor, timerFor, useNow, type Timer } from '../lib/tasks';
import { clientKeyOf, groupClients, rhythmScopes } from '../lib/handles';
import { addDays, dayKey, startOfWeek } from '../lib/dates';
import { ColorSwatches, useClientColors } from '../lib/clientColors';
import Logo from './Logo';
import type { Density, Theme } from '../lib/prefs';
import type { Task, Workspace } from '../types';

// Layout modelled on shadcn's sidebar-07: collapses to icons, clickable edge rail, Ctrl/⌘+B,
// grouped nav with collapsible sub-items, a "projects" list with per-item menus, and a user menu.

export type View = 'workspace' | 'calendar' | 'year' | 'stats' | 'archive';
export type Section = 'needs-attention' | 'in-progress' | 'waiting' | 'archived' | 'trash';

export const WORKSPACES: Record<Workspace, { name: string; detail: string; letter: string }> = {
  agency: { name: 'Mint-more', detail: 'Agency workspace', letter: 'M' },
  personal: { name: 'Personal', detail: 'Personal workspace', letter: 'P' },
};

export const SIDEBAR_WIDTH = 256; // px, expanded (default; drag the edge to resize)
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 440;
export const SIDEBAR_SNAP = 140; // drag narrower than this and it snaps closed
export const SIDEBAR_ICON_WIDTH = 56; // px, collapsed to icons

interface Props {
  user: User;
  view: View;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  width: number; // expanded width
  resizing: boolean;
  onResize: (pointerX: number) => void; // while dragging the edge
  onResizingChange: (resizing: boolean) => void;
  onResetWidth: () => void;
  onNavigate: (view: View, opts?: { day?: string; section?: Section; keepOpen?: boolean }) => void;
  tasks: Task[];
  handles: Map<string, string>;
  onOpenTask: (id: string) => void;
  openTaskId: string | null;
  onAskAbout: (handle: string) => void;
  onDeleteTask: (id: string) => void;
  onArchiveTask: (id: string) => void;
  onOpenAssistant: () => void;
  workspace: Workspace;
  onSwitchWorkspace: (w: Workspace) => void;
  archivedCount: number;
  trashedCount: number;
  theme: Theme;
  density: Density;
  onSetTheme: (t: Theme) => void;
  onSetDensity: (d: Density) => void;
}

const Icon = ({ d, className = 'w-[18px] h-[18px]' }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={`${className} shrink-0`}>
    <path d={d} />
  </svg>
);
const LIST = 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01';
const CAL = 'M4 5h16v15H4zM4 10h16M8 3v4M16 3v4';
const CHEVRON_RIGHT = 'M9 6l6 6-6 6';
const DOTS = 'M5 12h.01M12 12h.01M19 12h.01';
const UPDOWN = 'M8 9l4-4 4 4M16 15l-4 4-4-4';
const LOGOUT = 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11';
const SPARK = 'M12 3l1.8 4.9L19 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5 9.7l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z';
const PANEL = 'M4 5h16v14H4zM9.5 5v14';
const OPEN = 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5';
const TRASH = 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3';
const CHART = 'M4 20V10M10 20V4M16 20v-7M22 20H2';
const ARCHIVE = 'M3 5h18v4H3zM5 9v10h14V9M10 13h4';
const CHECK = 'M5 12l5 5 9-10';

// A client's tile: its initial(s) on its colour. Filled while active; a dotted outline (letters in the
// client's colour) while on hold. Urgency shows as a ring: amber when a check-in is due soon, red when late.
const TONE_RING: Record<Timer['tone'], string> = { green: '', orange: '#f59e0b', red: '#ef4444', waiting: '' };
function ClientTile({ color, tone, label }: { color: string; tone: Timer['tone']; label: string }) {
  const ring = TONE_RING[tone];
  const onHold = tone === 'waiting';
  return (
    <span
      className="flex h-5 min-w-5 items-center justify-center rounded-[5px] px-[3px] font-display text-[0.625rem] font-bold leading-none tracking-tight"
      style={{
        background: onHold ? 'transparent' : color,
        color: onHold ? color : '#ffffff',
        border: onHold ? `1.5px dashed ${color}` : undefined,
        boxShadow: ring ? `0 0 0 2px var(--bg-color), 0 0 0 3.5px ${ring}` : undefined,
      }}
    >
      {label}
    </span>
  );
}

// Shortest unique initials per client: "T" for Tomboy, but "TO" and "TA" once Tamarind joins.
function monograms(entries: [key: string, name: string][]) {
  const letters = (name: string) => name.replace(/[^a-z0-9]/gi, '').toUpperCase() || '?';
  const out = new Map<string, string>();
  for (const [key, name] of entries) {
    const l = letters(name);
    let n = 1;
    while (n < Math.min(3, l.length) && entries.some(([k, other]) => k !== key && letters(other).startsWith(l.slice(0, n)))) n++;
    out.set(key, l.slice(0, n));
  }
  return out;
}

// Closes a popover when clicking anywhere outside it.
function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);
  return ref;
}

// Label shown next to an icon when collapsed: a small tooltip on hover.
function Tip({ collapsed, label }: { collapsed: boolean; label: string }) {
  if (!collapsed) return null;
  return (
    <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--text-main)] px-2 py-1 text-xs text-[var(--bg-color)] opacity-0 group-hover/item:opacity-100 transition-opacity">
      {label}
    </span>
  );
}

export default function Sidebar({
  user,
  view,
  collapsed,
  onToggleCollapsed,
  width,
  resizing,
  onResize,
  onResizingChange,
  onResetWidth,
  onNavigate,
  tasks,
  handles,
  onOpenTask,
  openTaskId,
  onAskAbout,
  onDeleteTask,
  onArchiveTask,
  onOpenAssistant,
  workspace,
  onSwitchWorkspace,
  archivedCount,
  trashedCount,
  theme,
  density,
  onSetTheme,
  onSetDensity,
}: Props) {
  const { colorOf } = useClientColors();
  const [switcher, setSwitcher] = useState(false);
  const switcherRef = useOutsideClose(switcher, () => setSwitcher(false));
  const now = useNow();
  const todayKey = dayKey(new Date(now));
  const [expandedNav, setExpandedNav] = useState<Record<string, boolean>>({ workspace: true });
  const [showAllClients, setShowAllClients] = useState(false);
  // Open "⋯" menu: for a task or a whole client, and where (fixed position, so the scrolling list can't clip it).
  const [clientMenu, setClientMenu] = useState<{ kind: 'task' | 'client'; id: string; top: number; left: number } | null>(null);
  const [openClients, setOpenClients] = useState<Set<string>>(new Set()); // expanded client groups
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [userMenu, setUserMenu] = useState(false);
  const clientMenuRef = useOutsideClose(clientMenu !== null, () => {
    setClientMenu(null);
    setConfirmDelete(null);
  });
  const userMenuRef = useOutsideClose(userMenu, () => setUserMenu(false));

  // Clients (tasks grouped by client), most urgent first, each with the ring colour of its most urgent task.
  const scopes = rhythmScopes(tasks);
  const urgency = (t: Timer) => ({ red: 3, orange: 2, green: 1, waiting: 0 })[t.tone] + t.progress;
  const clients = [...groupClients(tasks).values()]
    .map((g) => {
      const items = g.tasks
        .map((task) => ({ task, timer: timerFor(task, now, todayKey, scopes.get(task.id)) }))
        .sort((a, b) => urgency(b.timer) - urgency(a.timer));
      return { group: g, items, top: items[0].timer, color: colorOf(g.key) };
    })
    .sort((a, b) => urgency(b.top) - urgency(a.top));
  // On hold at client level: every one of the client's tasks is on hold. Each client shows in one list only.
  const heldClients = clients.filter((c) => c.items.every(({ task }) => task.waiting_since));
  const activeClients = clients.filter((c) => !heldClients.includes(c));
  // Same split as the workspace: clients with a task that needs attention, then the rest.
  const urgentClients = activeClients.filter((c) => c.items.some(({ task }) => attentionFor(task, now, todayKey, scopes.get(task.id))));
  const calmClients = activeClients.filter((c) => !urgentClients.includes(c));
  const visibleClients = showAllClients ? calmClients : calmClients.slice(0, 7);
  const clientInitials = monograms(clients.map((c) => [c.group.key, c.group.name]));
  const initialsOf = (key: string) => clientInitials.get(key) ?? key.charAt(0).toUpperCase();
  const activeCount = clients.reduce((n, c) => n + c.items.length, 0);

  const email = user.email ?? '';
  // "devdeep120205@…" → "Devdeep": drop digits and separators from the email's name part.
  const name =
    email
      .split('@')[0]
      .replace(/[0-9._-]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()) || 'You';
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  const nextMonday = dayKey(addDays(startOfWeek(new Date(now)), 7));
  const nav: { id: View; views: View[]; label: string; icon: string; badge?: number; sub: { label: string; go: () => void }[] }[] = [
    {
      id: 'workspace',
      views: ['workspace'],
      label: 'Workspace',
      icon: LIST,
      badge: activeCount,
      sub: [
        { label: 'Needs attention', go: () => onNavigate('workspace', { section: 'needs-attention' }) },
        { label: 'In progress', go: () => onNavigate('workspace', { section: 'in-progress' }) },
      ],
    },
    {
      id: 'calendar',
      views: ['calendar'],
      label: 'Calendar',
      icon: CAL,
      sub: [
        { label: 'Today', go: () => onNavigate('calendar', { day: todayKey }) },
        { label: 'Next week', go: () => onNavigate('calendar', { day: nextMonday }) },
      ],
    },
    {
      id: 'year',
      views: ['year', 'stats'],
      label: 'Insights',
      icon: CHART,
      sub: [
        { label: 'Year', go: () => onNavigate('year') },
        { label: 'Stats', go: () => onNavigate('stats') },
      ],
    },
    {
      id: 'archive',
      views: ['archive'],
      label: 'Archive',
      icon: ARCHIVE,
      badge: archivedCount + trashedCount || undefined,
      sub: [
        { label: `Archived · ${archivedCount}`, go: () => onNavigate('archive', { section: 'archived' }) },
        { label: `Trash · ${trashedCount}`, go: () => onNavigate('archive', { section: 'trash' }) },
      ],
    },
  ];
  const clientsLabel = workspace === 'agency' ? 'Work' : 'Projects';

  const itemBase =
    'group/item relative flex w-full items-center gap-2.5 rounded-lg px-2.5 h-9 text-sm transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#257EF4]';
  const groupLabel = (text: string) =>
    collapsed ? (
      <div className="mx-auto my-2 h-px w-6 bg-[var(--line-color)]" />
    ) : (
      <div className="px-2.5 pb-1 pt-3 font-display text-[0.6875rem] font-medium text-[var(--text-muted)]">{text}</div>
    );

  const section = (children: ReactNode) => <div className="px-2">{children}</div>;
  // A group inside Clients: a small label when expanded, a separator line when collapsed.
  const subLabel = (text: string, dot: string) =>
    collapsed ? (
      <div className="mx-auto my-2 h-px w-6 bg-[var(--line-color)]" />
    ) : (
      <div className="flex items-center gap-1.5 px-2.5 pb-0.5 pt-2 text-[0.6875rem] text-[var(--text-muted)]">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {text}
      </div>
    );

  // One client: a single-task client is a plain row; several tasks make a collapsible group.
  type ClientEntry = (typeof clients)[number];
  const renderClient = ({ group, items, top, color }: ClientEntry, held = false) => {
      if (items.length === 1) {
        const only = items[0].task;
        return taskRow(only, items[0].timer, held && only.waiting_for ? `${only.text} · ${only.waiting_for}` : only.text, false, '', group.key);
      }
      const open = openClients.has(group.key) && !collapsed;
      const menuOpen = clientMenu?.kind === 'client' && clientMenu.id === group.key;
      return (
        <div key={group.key}>
          <div className="group/client relative">
            <button
              onClick={() =>
                setOpenClients((prev) => {
                  const next = new Set(prev);
                  if (next.has(group.key)) next.delete(group.key);
                  else next.add(group.key);
                  return next;
                })
              }
              aria-expanded={open}
              className={`${itemBase} ${collapsed ? 'justify-center px-0' : 'pr-8'} text-[var(--text-main)] hover:bg-[var(--surface)]/70`}
            >
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center">
                <ClientTile color={color} tone={top.tone} label={initialsOf(group.key)} />
              </span>
              {!collapsed && (
                <>
                  <span className="flex-1 truncate text-left font-medium">{group.name}</span>
                  <span className="text-xs text-[var(--text-muted)] tabular-nums">{items.length}</span>
                  <span className={`text-[var(--text-muted)] transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
                    <Icon d={CHEVRON_RIGHT} className="w-3.5 h-3.5" />
                  </span>
                </>
              )}
              <Tip collapsed={collapsed} label={`${group.name} · ${items.length} tasks · @${group.key}`} />
            </button>
            {!collapsed && moreButton('client', group.key, `More for ${group.name}`, menuOpen)}
            {menuOpen && (
              <div
                ref={clientMenuRef}
                style={{ top: clientMenu.top, left: clientMenu.left }}
                className="fixed z-50 w-56 rounded-xl border border-[var(--line-color)] bg-[var(--surface)] py-1 text-sm shadow-xl"
              >
                <div className="px-3 py-1.5 font-display text-[0.6875rem] text-[#257EF4]">
                  @{group.key} · {items.length} tasks, one check-in rhythm
                </div>
                <button
                  onClick={() => {
                    setClientMenu(null);
                    onAskAbout(group.key);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-[var(--bg-color)] cursor-pointer"
                >
                  <Icon d={SPARK} className="w-4 h-4" /> Ask Bouncy about {group.name}
                </button>
                <div className="my-1 h-px bg-[var(--line-color)]" />
                <ColorSwatches clientKey={group.key} />
                <div className="my-1 h-px bg-[var(--line-color)]" />
                {items.map(({ task }) => (
                  <button
                    key={task.id}
                    onClick={() => {
                      setClientMenu(null);
                      onOpenTask(task.id);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-[var(--bg-color)] cursor-pointer"
                  >
                    <Icon d={OPEN} className="w-4 h-4" /> <span className="truncate">Open {task.text}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={`expand-grid ${open ? 'is-open' : ''}`}>
            <div className="expand-inner">
              <div className="ml-[21px] mb-1 border-l border-[var(--line-color)] pl-1.5">
                {items.map(({ task, timer }) => taskRow(task, timer, task.text, true, '', group.key))}
              </div>
            </div>
          </div>
        </div>
      );
  };

  // A labelled row of options, for the appearance settings.
  const segmented = <T extends string>(label: string, value: T, set: (v: T) => void, options: [T, string][]) => (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <span className="w-14 text-xs text-[var(--text-muted)]">{label}</span>
      <div className="flex flex-1 rounded-lg bg-[var(--bg-color)] p-0.5">
        {options.map(([v, text]) => (
          <button
            key={v}
            onClick={() => set(v)}
            aria-pressed={value === v}
            className={`flex-1 rounded-md py-1 text-xs transition-colors cursor-pointer ${
              value === v ? 'bg-[var(--surface)] font-medium text-[var(--text-main)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );

  const moreButton = (kind: 'task' | 'client', id: string, label: string, isOpen: boolean) => (
    <button
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setClientMenu(isOpen ? null : { kind, id, top: Math.min(r.top, window.innerHeight - 220), left: r.right + 8 });
        setConfirmDelete(null);
      }}
      aria-label={label}
      className={`absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text-main)] transition-opacity cursor-pointer ${
        isOpen ? 'opacity-100' : 'opacity-0 group-hover/client:opacity-100 focus:opacity-100'
      }`}
    >
      <Icon d={DOTS} className="w-4 h-4" />
    </button>
  );

  // One task row with its ring-colour dot and a "⋯" menu (Open / Ask Bouncy / Delete).
  const taskRow = (task: Task, timer: Timer, label: string, nested = false, keyPrefix = '', clientKey?: string) => {
    const handle = handles.get(task.id) ?? '';
    const menuId = `${keyPrefix}${task.id}`;
    const menuOpen = clientMenu?.kind === 'task' && clientMenu.id === menuId;
    if (nested && collapsed) return null;
    return (
      <div key={menuId} className="group/client relative">
        <button
          onClick={() => onOpenTask(task.id)}
          aria-pressed={openTaskId === task.id}
          className={`${itemBase} ${collapsed ? 'justify-center px-0' : 'pr-8'} ${nested ? 'h-8 text-[0.8125rem]' : ''} ${
            openTaskId === task.id
              ? 'bg-[var(--surface)] font-medium text-[var(--text-main)] shadow-sm'
              : 'text-[var(--text-muted)] hover:bg-[var(--surface)]/70 hover:text-[var(--text-main)]'
          }`}
        >
          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center">
            <ClientTile color={colorOf(clientKey ?? clientKeyOf(task))} tone={timer.tone} label={initialsOf(clientKey ?? clientKeyOf(task))} />
          </span>
          {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
          <Tip collapsed={collapsed} label={`${task.text} · @${handle}`} />
        </button>
        {!collapsed && moreButton('task', menuId, `More for ${task.text}`, menuOpen)}
        {menuOpen && (
          <div
            ref={clientMenuRef}
            style={{ top: clientMenu.top, left: clientMenu.left }}
            className="fixed z-50 w-52 rounded-xl border border-[var(--line-color)] bg-[var(--surface)] py-1 text-sm shadow-xl"
          >
            <div className="px-3 py-1.5 font-display text-[0.6875rem] text-[#257EF4]">@{handle}</div>
            <button
              onClick={() => {
                setClientMenu(null);
                onOpenTask(task.id);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-[var(--bg-color)] cursor-pointer"
            >
              <Icon d={OPEN} className="w-4 h-4" /> Open task
            </button>
            <button
              onClick={() => {
                setClientMenu(null);
                onAskAbout(handle);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-[var(--bg-color)] cursor-pointer"
            >
              <Icon d={SPARK} className="w-4 h-4" /> Ask Bouncy about it
            </button>
            {!nested && clientKey && (
              <>
                <div className="my-1 h-px bg-[var(--line-color)]" />
                <ColorSwatches clientKey={clientKey} />
              </>
            )}
            <div className="my-1 h-px bg-[var(--line-color)]" />
            <button
              onClick={() => {
                setClientMenu(null);
                onArchiveTask(task.id);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-[var(--bg-color)] cursor-pointer"
            >
              <Icon d={ARCHIVE} className="w-4 h-4" /> Archive
            </button>
            <button
              onClick={() => {
                if (confirmDelete === task.id) {
                  setClientMenu(null);
                  setConfirmDelete(null);
                  onDeleteTask(task.id);
                } else setConfirmDelete(task.id);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer"
            >
              <Icon d={TRASH} className="w-4 h-4" /> {confirmDelete === task.id ? 'Click again to confirm' : 'Move to trash'}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      style={{ width: collapsed ? SIDEBAR_ICON_WIDTH : width }}
      className={`fixed inset-y-0 left-0 z-20 flex flex-col border-r border-[var(--line-color)] bg-[var(--bg-color)] ${
        resizing ? '' : 'transition-[width,translate] duration-200 ease-linear'
      } ${collapsed ? 'max-md:-translate-x-full' : ''} ${
        collapsed ? '' : 'shadow-xl md:shadow-none'
      }`}
    >
      {/* Header: workspace switcher, as in sidebar-07's team switcher */}
      <div className="relative p-2" ref={switcherRef}>
        <button
          onClick={() => setSwitcher((v) => !v)}
          onDoubleClick={() => {
            // Double-click: jump straight to the other workspace.
            setSwitcher(false);
            onSwitchWorkspace(workspace === 'agency' ? 'personal' : 'agency');
          }}
          aria-expanded={switcher}
          className={`${itemBase} h-12 p-1.5 ${collapsed ? 'justify-center px-0' : ''} ${switcher ? 'bg-[var(--surface)] shadow-sm' : 'hover:bg-[var(--surface)]/70'}`}
        >
          <Logo size={32} variant={workspace} />
          {!collapsed && (
            <>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate font-display text-sm font-semibold">{WORKSPACES[workspace].name}</span>
                <span className="truncate text-xs text-[var(--text-muted)]">{WORKSPACES[workspace].detail}</span>
              </span>
              <Icon d={UPDOWN} className="w-4 h-4 text-[var(--text-muted)]" />
            </>
          )}
          <Tip collapsed={collapsed} label={`${WORKSPACES[workspace].name} · double-click to switch`} />
        </button>
        {switcher && (
          <div
            className={`absolute z-50 w-60 rounded-xl border border-[var(--line-color)] bg-[var(--surface)] py-1 text-sm shadow-xl ${
              collapsed ? 'top-2 left-full ml-2' : 'top-full left-2 mt-1'
            }`}
          >
            <div className="px-3 py-1.5 font-display text-[0.6875rem] text-[var(--text-muted)]">Workspaces</div>
            {(Object.keys(WORKSPACES) as Workspace[]).map((w, i) => (
              <button
                key={w}
                onClick={() => {
                  setSwitcher(false);
                  if (w !== workspace) onSwitchWorkspace(w);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-[var(--bg-color)] cursor-pointer"
              >
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--line-color)] font-display text-[0.6875rem] font-semibold"
                  style={{ color: w === 'agency' ? 'var(--accent)' : '#8b5cf6' }}
                >
                  {WORKSPACES[w].letter}
                </span>
                <span className="flex-1 text-left">{WORKSPACES[w].name}</span>
                {w === workspace ? <Icon d={CHECK} className="w-4 h-4 text-[var(--accent)]" /> : <kbd className="text-[0.6875rem] text-[var(--text-muted)]">Alt {i + 1}</kbd>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Collapsed: let icon tooltips spill out to the right instead of being clipped. */}
      <div className={`flex-1 min-h-0 ${collapsed ? 'overflow-visible' : 'overflow-y-auto overflow-x-hidden'}`}>
        {/* Platform: views with collapsible sub-items */}
        {groupLabel('Platform')}
        {section(
          nav.map((item) => {
            const active = item.views.includes(view);
            const open = expandedNav[item.id] && !collapsed;
            return (
              <div key={item.id}>
                <button
                  onClick={() => {
                    // A main tab also opens its sub-tabs, so on phones the drawer stays open for them.
                    onNavigate(item.id, { keepOpen: true });
                    if (!collapsed) setExpandedNav((s) => ({ ...s, [item.id]: active ? !s[item.id] : true }));
                  }}
                  aria-expanded={open}
                  className={`${itemBase} ${collapsed ? 'justify-center px-0' : ''} ${
                    active ? 'bg-[var(--surface)] font-medium text-[var(--text-main)] shadow-sm' : 'text-[var(--text-muted)] hover:bg-[var(--surface)]/70 hover:text-[var(--text-main)]'
                  }`}
                >
                  <Icon d={item.icon} />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate text-left">{item.label}</span>
                      {item.badge !== undefined && <span className="text-xs text-[var(--text-muted)] tabular-nums">{item.badge}</span>}
                      <span className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
                        <Icon d={CHEVRON_RIGHT} className="w-3.5 h-3.5" />
                      </span>
                    </>
                  )}
                  <Tip collapsed={collapsed} label={item.label} />
                </button>
                <div className={`expand-grid ${open ? 'is-open' : ''}`}>
                  <div className="expand-inner">
                    <div className="ml-[21px] mt-0.5 mb-1 flex flex-col border-l border-[var(--line-color)] pl-2.5">
                      {item.sub.map((s) => (
                        <button
                          key={s.label}
                          onClick={s.go}
                          className="rounded-md px-2 py-1.5 text-left text-[0.8125rem] text-[var(--text-muted)] hover:bg-[var(--surface)]/70 hover:text-[var(--text-main)] transition-colors cursor-pointer"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          }),
        )}

        {/* Clients (like sidebar-07's Projects): collapsible groups of a client's tasks */}
        {clients.length > 0 && !collapsed && groupLabel(clientsLabel)}
        {urgentClients.length > 0 && (
          <>
            {subLabel(`Needs attention · ${urgentClients.length}`, 'bg-red-500')}
            {section(urgentClients.map((c) => renderClient(c)))}
          </>
        )}
        {calmClients.length > 0 && (
          <>
            {subLabel(`In progress · ${calmClients.length}`, 'bg-[var(--text-main)]')}
            {section(
              <>
                {visibleClients.map((c) => renderClient(c))}
                {!collapsed && calmClients.length > 7 && (
                  <button
                    onClick={() => setShowAllClients((v) => !v)}
                    className={`${itemBase} text-[var(--text-muted)] hover:bg-[var(--surface)]/70 hover:text-[var(--text-main)]`}
                  >
                    <Icon d={DOTS} />
                    <span>{showAllClients ? 'Show less' : `${calmClients.length - 7} more`}</span>
                  </button>
                )}
              </>,
            )}
          </>
        )}

        {/* On hold: clients whose work is all paused or blocked (dotted tiles) */}
        {heldClients.length > 0 && (
          <>
            {subLabel(`On hold · ${heldClients.length}`, 'bg-[#257ef4]')}
            {section(heldClients.map((c) => renderClient(c, true)))}
          </>
        )}
      </div>

      {/* User menu */}
      <div className="relative p-2" ref={userMenuRef}>
        <button
          onClick={() => setUserMenu((v) => !v)}
          aria-expanded={userMenu}
          className={`${itemBase} h-12 ${collapsed ? 'justify-center px-0' : ''} ${userMenu ? 'bg-[var(--surface)] shadow-sm' : 'hover:bg-[var(--surface)]/70'}`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#257EF4] font-display text-xs font-semibold text-white">
            {initials}
          </span>
          {!collapsed && (
            <>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{name}</span>
                <span className="truncate text-xs text-[var(--text-muted)]">{email}</span>
              </span>
              <Icon d={UPDOWN} className="w-4 h-4 text-[var(--text-muted)]" />
            </>
          )}
          <Tip collapsed={collapsed} label={email} />
        </button>
        {userMenu && (
          <div
            className={`absolute z-50 w-60 rounded-xl border border-[var(--line-color)] bg-[var(--surface)] py-1 text-sm shadow-xl ${
              collapsed ? 'bottom-2 left-full ml-2' : 'bottom-full left-2 mb-1'
            }`}
          >
            <div className="flex items-center gap-2.5 px-3 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#257EF4] font-display text-xs font-semibold text-white">
                {initials}
              </span>
              <span className="grid min-w-0 leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-[var(--text-muted)]">{email}</span>
              </span>
            </div>
            <div className="my-1 h-px bg-[var(--line-color)]" />
            <button
              onClick={() => {
                setUserMenu(false);
                onOpenAssistant();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-[var(--bg-color)] cursor-pointer"
            >
              <Icon d={SPARK} className="w-4 h-4" /> <span className="flex-1 text-left">Open Bouncy</span>
              <kbd className="text-[0.6875rem] text-[var(--text-muted)]">/</kbd>
            </button>
            <button
              onClick={() => {
                setUserMenu(false);
                onToggleCollapsed();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-[var(--bg-color)] cursor-pointer"
            >
              <Icon d={PANEL} className="w-4 h-4" /> <span className="flex-1 text-left">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
              <kbd className="text-[0.6875rem] text-[var(--text-muted)]">Ctrl B</kbd>
            </button>
            <div className="my-1 h-px bg-[var(--line-color)]" />
            {segmented<Theme>('Theme', theme, onSetTheme, [
              ['light', 'Light'],
              ['dark', 'Dark'],
              ['system', 'Auto'],
            ])}
            {segmented<Density>('Density', density, onSetDensity, [
              ['comfortable', 'Roomy'],
              ['compact', 'Compact'],
            ])}
            <div className="my-1 h-px bg-[var(--line-color)]" />
            <button
              onClick={() => supabase.auth.signOut()}
              className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-[var(--bg-color)] cursor-pointer"
            >
              <Icon d={LOGOUT} className="w-4 h-4" /> Log out
            </button>
          </div>
        )}
      </div>

      {/* Rail: drag the right edge to resize (too narrow snaps it closed); click toggles; double-click resets. */}
      <button
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const startX = e.clientX;
          let dragged = false;
          const move = (ev: PointerEvent) => {
            if (!dragged && Math.abs(ev.clientX - startX) < 4) return;
            if (!dragged) {
              dragged = true;
              onResizingChange(true);
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }
            onResize(ev.clientX);
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            if (dragged) onResizingChange(false);
            else onToggleCollapsed();
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
        onDoubleClick={onResetWidth}
        aria-label={collapsed ? 'Expand sidebar' : 'Resize or collapse sidebar'}
        tabIndex={-1}
        className={`absolute inset-y-0 -right-2 hidden w-4 cursor-col-resize touch-none md:block after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:transition-colors hover:after:bg-[var(--accent)]/40 ${
          resizing ? 'after:bg-[var(--accent)]/60' : ''
        }`}
      />
    </aside>
  );
}
