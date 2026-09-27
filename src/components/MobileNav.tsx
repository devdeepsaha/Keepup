import type { View } from './Sidebar';

// Phones: four quick destinations at the bottom of the screen, within thumb reach.

interface Props {
  view: View;
  assistantOpen: boolean;
  attention: number; // tasks that need attention (badge on Tasks)
  onNavigate: (view: View) => void;
  onOpenAssistant: () => void;
}

const ICONS = {
  tasks: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  calendar: 'M4 5h16v15H4zM4 10h16M8 3v4M16 3v4',
  insights: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
};

export default function MobileNav({ view, assistantOpen, attention, onNavigate, onOpenAssistant }: Props) {
  const item = (label: string, icon: string, active: boolean, onClick: () => void, badge = 0) => (
    <button
      key={label}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`relative flex flex-1 flex-col items-center justify-center gap-1 py-2 font-display text-[0.6875rem] transition-colors cursor-pointer ${
        active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] active:text-[var(--text-main)]'
      }`}
    >
      <span className="relative">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.1 : 1.75} strokeLinecap="round" strokeLinejoin="round" className="h-[22px] w-[22px]">
          <path d={icon} />
        </svg>
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[0.625rem] font-semibold leading-none text-white">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </span>
      {label}
      {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-[var(--accent)]" />}
    </button>
  );

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-[25] flex border-t border-[var(--line-color)] bg-[var(--bg-color)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {item('Tasks', ICONS.tasks, view === 'workspace' && !assistantOpen, () => onNavigate('workspace'), attention)}
      {item('Calendar', ICONS.calendar, view === 'calendar' && !assistantOpen, () => onNavigate('calendar'))}
      {/* Bouncy in the middle: its own little orb */}
      <button
        onClick={onOpenAssistant}
        aria-label="Open Bouncy"
        aria-current={assistantOpen ? 'page' : undefined}
        className="flex flex-1 flex-col items-center justify-center gap-1 py-2 font-display text-[0.6875rem] cursor-pointer"
      >
        <span className={`flex h-[26px] w-[26px] items-center justify-center rounded-full bg-accent-gradient shadow-md shadow-[#257ef4]/30 ${assistantOpen ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-color)]' : ''}`}>
          <span className="flex gap-[5px]">
            <span className="h-[7px] w-[3px] rounded-full bg-white" />
            <span className="h-[7px] w-[3px] rounded-full bg-white" />
          </span>
        </span>
        <span className={assistantOpen ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}>Bouncy</span>
      </button>
      {item('Insights', ICONS.insights, (view === 'year' || view === 'stats') && !assistantOpen, () => onNavigate('year'))}
    </nav>
  );
}
