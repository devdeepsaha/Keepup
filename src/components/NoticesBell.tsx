import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../lib/org';
import { describeEvent, timeAgo, type TaskEvent } from '../lib/notices';
import { useBackClose } from '../lib/backStack';

// The bell in the top bar: what colleagues changed on your tasks, and replies to tasks you assigned.
export default function NoticesBell({ userId, onOpen }: { userId: string; onOpen: (e: TaskEvent) => void }) {
  const { nameOf } = useOrg();
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useBackClose(open, () => setOpen(false));

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('task_events')
      .select('id, task_id, owner_id, actor_id, notify_id, kind, detail, created_at, seen_at')
      .eq('notify_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (data) setEvents(data as TaskEvent[]);
  }, [userId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`notices-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_events', filter: `notify_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, userId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const unseen = events.filter((e) => !e.seen_at).length;
  const markAllSeen = async () => {
    const at = new Date().toISOString();
    setEvents((prev) => prev.map((e) => (e.seen_at ? e : { ...e, seen_at: at })));
    await supabase.from('task_events').update({ seen_at: at }).eq('notify_id', userId).is('seen_at', null);
  };

  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={unseen ? `Notices, ${unseen} new` : 'Notices'}
        aria-expanded={open}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--line-color)]/60 hover:text-[var(--text-main)] transition-colors cursor-pointer"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unseen > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[0.625rem] font-semibold leading-none text-white">
            {unseen > 9 ? '9+' : unseen}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--line-color)] bg-[var(--surface)] shadow-xl">
          <div className="flex items-center justify-between border-b border-[var(--line-color)] px-3 py-2">
            <span className="font-display text-sm font-semibold">Notices</span>
            {unseen > 0 && (
              <button onClick={markAllSeen} className="font-display text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer">
                Mark all seen
              </button>
            )}
          </div>
          {events.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
              Nothing yet. When a founder or manager changes or assigns your Mint-more work, it shows up here.
            </p>
          ) : (
            <ol className="max-h-[60vh] overflow-y-auto">
              {events.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => {
                      setOpen(false);
                      if (!e.seen_at) {
                        const at = new Date().toISOString();
                        setEvents((prev) => prev.map((x) => (x.id === e.id ? { ...x, seen_at: at } : x)));
                        supabase.from('task_events').update({ seen_at: at }).eq('id', e.id).then(() => {});
                      }
                      onOpen(e);
                    }}
                    className="flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-[var(--bg-color)] cursor-pointer"
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.seen_at ? 'bg-transparent' : 'bg-[#257ef4]'}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm leading-snug ${e.seen_at ? 'text-[var(--text-muted)]' : 'text-[var(--text-main)]'}`}>
                        {describeEvent(e, nameOf, userId)}
                      </span>
                      <span className="font-display text-[0.6875rem] text-[var(--text-muted)]">{timeAgo(e.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
