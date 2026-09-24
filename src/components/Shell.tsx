import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { User } from '@supabase/supabase-js';
import { useTasks } from '../hooks/useTasks';
import { taskHandles } from '../lib/handles';
import { ClientColorsProvider } from '../lib/clientColors';
import { usePrefs } from '../lib/prefs';
import type { Workspace as WorkspaceId } from '../types';
import ArchiveView from './ArchiveView';
import AssistantPanel from './AssistantPanel';
import CalendarView from './CalendarView';
import { StatsView, YearView } from './InsightsViews';
import Sidebar, {
  SIDEBAR_ICON_WIDTH,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SIDEBAR_SNAP,
  SIDEBAR_WIDTH,
  WORKSPACES,
  type Section,
  type View,
} from './Sidebar';
import Workspace from './Workspace';

const SIDEBAR_KEY = 'agenda.sidebarCollapsed';
const ASSISTANT_KEY = 'agenda.assistantOpen';
const WORKSPACE_KEY = 'agenda.workspace';
const WIDTH_KEY = 'agenda.sidebarWidth';

function readWidth() {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    return w >= SIDEBAR_MIN && w <= SIDEBAR_MAX ? w : SIDEBAR_WIDTH;
  } catch {
    return SIDEBAR_WIDTH;
  }
}

function readWorkspace(): WorkspaceId {
  try {
    return localStorage.getItem(WORKSPACE_KEY) === 'personal' ? 'personal' : 'agency';
  } catch {
    return 'agency';
  }
}

function readCollapsed() {
  try {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved !== null) return saved === '1';
  } catch {
    // storage unavailable; fall through to default
  }
  return window.innerWidth < 768;
}

const VIEW_LABEL: Record<View, string> = {
  workspace: 'Workspace',
  calendar: 'Calendar',
  year: 'Insights › Year',
  stats: 'Insights › Stats',
  archive: 'Archive',
};

export default function Shell({ user }: { user: User }) {
  const [workspace, setWorkspaceState] = useState<WorkspaceId>(readWorkspace);
  const {
    tasks,
    archived,
    trashed,
    history,
    loading,
    error,
    refetch,
    dismissError,
    addTask,
    toggleTask,
    renameTask,
    setDueDate,
    setCadence,
    setHandle,
    setClient,
    setWaiting,
    deleteTask,
    restoreTask,
    archiveTask,
    purgeTask,
    addUpdate,
    deleteUpdate,
  } = useTasks(user.id, workspace);
  const prefs = usePrefs();
  const switchWorkspace = useCallback((w: WorkspaceId) => {
    setWorkspaceState(w);
    try {
      localStorage.setItem(WORKSPACE_KEY, w);
    } catch {
      // storage unavailable; it just won't be remembered
    }
  }, []);
  const [view, setView] = useState<View>('workspace');
  const [calendarDay, setCalendarDay] = useState<string | undefined>();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [focusTask, setFocusTask] = useState<{ id: string; nonce: number } | null>(null); // scroll to a task
  const [openTaskId, setOpenTaskId] = useState<string | null>(null); // one task open at a time
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null); // text to start the assistant with
  const [assistantOpen, setAssistantOpenState] = useState(() => {
    try {
      return localStorage.getItem(ASSISTANT_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setAssistantOpen = useCallback((open: boolean) => {
    setAssistantOpenState(open);
    try {
      localStorage.setItem(ASSISTANT_KEY, open ? '1' : '0');
    } catch {
      // storage unavailable; the panel just won't be remembered
    }
  }, []);

  const setCollapsedSaved = useCallback((value: boolean | ((c: boolean) => boolean)) => {
    setCollapsed((c) => {
      const next = typeof value === 'function' ? value(c) : value;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }, []);
  const toggleCollapsed = useCallback(() => setCollapsedSaved((c) => !c), [setCollapsedSaved]);

  // Dragging the sidebar's edge: follow the pointer; too close to the left edge snaps it closed.
  const [width, setWidth] = useState(readWidth);
  const [resizing, setResizing] = useState(false);
  const saveWidth = (w: number) => {
    try {
      localStorage.setItem(WIDTH_KEY, String(w));
    } catch {
      // ignore
    }
  };
  const resizeTo = (x: number) => {
    if (x < SIDEBAR_SNAP) return setCollapsedSaved(true);
    setCollapsedSaved(false);
    const w = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, x)));
    setWidth(w);
    saveWidth(w);
  };

  // Ctrl/⌘+B toggles the sidebar, as in shadcn's sidebar; Alt+1 / Alt+2 switch workspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'b' && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault();
        toggleCollapsed();
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'Digit1' || e.code === 'Digit2')) {
        e.preventDefault();
        switchWorkspace(e.code === 'Digit1' ? 'agency' : 'personal');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleCollapsed, switchWorkspace]);

  const navigate = (v: View, opts: { day?: string; section?: Section } = {}) => {
    setView(v);
    setCalendarDay(opts.day);
    if (opts.section) {
      // wait for the view to render, then bring the section into view
      window.setTimeout(() => document.getElementById(opts.section!)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    } else window.scrollTo({ top: 0 });
  };

  // From the sidebar: open that task (closing any other); clicking the open one again closes it.
  const openTask = (id: string) => {
    if (view === 'workspace' && openTaskId === id) return setOpenTaskId(null);
    setView('workspace');
    setOpenTaskId(id);
    setFocusTask({ id, nonce: Date.now() });
  };

  const askAbout = (handle: string) => {
    setAssistantOpen(true);
    setPrefill({ text: `@${handle} `, nonce: Date.now() });
  };

  const handles = useMemo(() => taskHandles(tasks), [tasks]);
  const sidebarWidth = collapsed ? SIDEBAR_ICON_WIDTH : width;

  return (
    <ClientColorsProvider workspace={workspace}>
    <div style={{ '--sb': `${sidebarWidth}px`, '--sb-icon': `${SIDEBAR_ICON_WIDTH}px` } as CSSProperties}>
      <Sidebar
        user={user}
        view={view}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        width={width}
        resizing={resizing}
        onResize={resizeTo}
        onResizingChange={setResizing}
        onResetWidth={() => {
          setWidth(SIDEBAR_WIDTH);
          saveWidth(SIDEBAR_WIDTH);
          setCollapsedSaved(false);
        }}
        onNavigate={navigate}
        tasks={tasks}
        handles={handles}
        onOpenTask={openTask}
        openTaskId={view === 'workspace' ? openTaskId : null}
        onAskAbout={askAbout}
        onDeleteTask={deleteTask}
        onArchiveTask={(id) => archiveTask(id, true)}
        onOpenAssistant={() => setAssistantOpen(true)}
        workspace={workspace}
        onSwitchWorkspace={switchWorkspace}
        archivedCount={archived.length}
        trashedCount={trashed.length}
        theme={prefs.theme}
        density={prefs.density}
        onSetTheme={prefs.setTheme}
        onSetDensity={prefs.setDensity}
      />

      {/* On small screens the expanded sidebar overlays content instead of pushing it. */}
      <div
        className={`min-h-screen pl-[var(--sb-icon)] md:pl-[var(--sb)] pb-10 ${resizing ? '' : 'transition-[padding] duration-200 ease-linear'} ${
          assistantOpen ? 'lg:pr-[380px]' : ''
        }`}
      >
        {/* Page header: sidebar toggle + breadcrumb */}
        <header className="flex h-12 items-center gap-2 px-4 pr-16">
          <button
            onClick={toggleCollapsed}
            aria-label="Toggle sidebar"
            title="Toggle sidebar (Ctrl+B)"
            className="-ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--line-color)]/60 hover:text-[var(--text-main)] transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
              <path d="M4 5h16v14H4zM9.5 5v14" />
            </svg>
          </button>
          <span className="h-4 w-px bg-[var(--line-color)]" />
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
            <button onClick={() => navigate('workspace')} className="hidden sm:inline text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer">
              {WORKSPACES[workspace].name}
            </button>
            <span className="hidden sm:inline text-[var(--text-muted)]">›</span>
            <span className="font-medium">{VIEW_LABEL[view]}</span>
          </nav>
        </header>

        {error && (
          <div className="mx-6 md:mx-12 lg:mx-20 mt-2 flex items-center justify-between gap-4 border-l-2 border-red-500 pl-4 py-2 text-sm">
            <span className="text-red-500">{error}</span>
            <button onClick={dismissError} className="text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer">
              Dismiss
            </button>
          </div>
        )}

        {view === 'workspace' ? (
          <Workspace
            tasks={tasks}
            loading={loading}
            focusTask={focusTask}
            openId={openTaskId}
            onOpenIdChange={setOpenTaskId}
            onAddTask={addTask}
            onToggle={toggleTask}
            onRename={renameTask}
            onSetDue={setDueDate}
            onSetCadence={setCadence}
            onSetHandle={setHandle}
            onSetClient={setClient}
            onSetWaiting={setWaiting}
            onDelete={deleteTask}
            onArchive={(id) => archiveTask(id, true)}
            onAddUpdate={addUpdate}
            onDeleteUpdate={deleteUpdate}
          />
        ) : view === 'calendar' ? (
          <CalendarView key={`${workspace}-${calendarDay ?? 'today'}`} tasks={history} loading={loading} initialDay={calendarDay} onToggle={toggleTask} />
        ) : view === 'year' ? (
          <YearView tasks={history} loading={loading} onOpenDay={(day) => navigate('calendar', { day })} />
        ) : view === 'stats' ? (
          <StatsView tasks={history} loading={loading} />
        ) : (
          <ArchiveView
            archived={archived}
            trashed={trashed}
            loading={loading}
            onRestore={restoreTask}
            onPurge={purgeTask}
            onTrash={deleteTask}
          />
        )}
      </div>

      <AssistantPanel
        key={workspace}
        workspace={workspace}
        tasks={tasks}
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        onChanged={refetch}
        prefill={prefill}
      />

      {/* Tap-away backdrop for the expanded sidebar on small screens */}
      {!collapsed && <div className="fixed inset-0 z-10 bg-black/10 md:hidden" onClick={toggleCollapsed} />}
    </div>
    </ClientColorsProvider>
  );
}
