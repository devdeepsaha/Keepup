import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import {
  askAssistant,
  logDraftSent,
  captureScreenshot,
  prepareImage,
  undoResult,
  type AiImage,
  type AiDraft,
  type AiResult,
  type HistoryTurn,
} from '../lib/ai';
import { createChat, deleteChat, listChats, loadChat, saveMessages, type ChatSummary, type Entry } from '../lib/chats';
import { dayKey } from '../lib/dates';
import { clientTags, taskHandles } from '../lib/handles';
import type { Task, Workspace } from '../types';
import { LiveOrb } from './LiveOrb';

// "@query" right before the caret (at the start or after a space), or null. Handles have no spaces.
function mentionAt(value: string, caret: number) {
  const m = value.slice(0, caret).match(/(?:^|\s)@([^\s@]{0,40})$/);
  return m ? { start: caret - m[1].length - 1, query: m[1] } : null;
}

const PILL = 'rounded-md bg-[#257EF4]/12 text-[#257EF4]';

// Splits text so each known "@handle" can be drawn as a pill.
// `inline`: pills in the input backdrop must not change the text's width, so their padding is cancelled
// by a negative margin and the font weight stays the same; that keeps them aligned with the textarea's caret.
function withMentions(text: string, handles: string[], inline = false) {
  if (!handles.length) return text;
  const alternatives = [...handles].sort((a, b) => b.length - a.length).join('|');
  return text.split(new RegExp(`(@(?:${alternatives}))(?![a-z0-9/])`, 'gi')).map((part, i) =>
    part.startsWith('@') && handles.includes(part.slice(1).toLowerCase()) ? (
      <span
        key={i}
        className={`${PILL} [box-decoration-break:clone] ${inline ? 'px-[3px] -mx-[3px] py-px' : 'px-1.5 py-0.5 font-medium'}`}
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}

const SUGGESTIONS = ["What's left?", 'Who do I need to update this week?', "What's overdue or going stale?"];

const KIND_LABEL: Record<AiResult['kind'], string> = {
  added: 'Added',
  logged: 'Logged',
  completed: 'Completed',
  reopened: 'Reopened',
  due: 'Due date',
  renamed: 'Renamed',
  rhythm: 'Rhythm',
  waiting: 'On hold',
  skipped: 'Skipped',
};

const Icon = ({ d, className = 'w-4 h-4' }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d={d} />
  </svg>
);
const PLUS = 'M12 5v14M5 12h14';
const ENTER = 'M9 10l-5 5 5 5M20 4v7a4 4 0 0 1-4 4H4';
const IMAGE = 'M4 5h16v14H4zM4 15l4-4 5 5 3-3 4 4M15 9h.01';
const MONITOR = 'M3 4h18v12H3zM8 20h8M12 16v4';
const CLOSE = 'M18 6L6 18M6 6l12 12';
const CLOCK = 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0';
const PEN = 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z';
const BACK = 'M15 18l-6-6 6-6';

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 animate-spin" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// Today / Yesterday / Previous 7 days / Earlier, like modern chat apps.
function groupChats(chats: ChatSummary[]) {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const weekAgo = dayKey(new Date(Date.now() - 7 * 86_400_000));
  const groups: { label: string; chats: ChatSummary[] }[] = [
    { label: 'Today', chats: [] },
    { label: 'Yesterday', chats: [] },
    { label: 'Previous 7 days', chats: [] },
    { label: 'Earlier', chats: [] },
  ];
  for (const c of chats) {
    const k = dayKey(c.updated_at);
    groups[k === today ? 0 : k === yesterday ? 1 : k >= weekAgo ? 2 : 3].chats.push(c);
  }
  return groups.filter((g) => g.chats.length);
}

interface Props {
  workspace: Workspace; // chats and changes stay within this workspace
  tasks: Task[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  prefill?: { text: string; nonce: number } | null; // start the input with this (e.g. "@tomboy ")
}

export default function AssistantPanel({ workspace, tasks, open, onOpenChange, onChanged, prefill }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [chatTitle, setChatTitle] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null); // highlighted in History
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState<AiImage[]>([]);
  const [pending, setPending] = useState(false);
  const [elapsed, setElapsed] = useState(0); // ms since the current request started
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dancing, setDancing] = useState<'launcher' | 'header' | 'hero' | null>(null); // Bouncy's hover dance
  // Phones have no hover: a tap on Bouncy makes it dance for a moment instead.
  const danceTimer = useRef<number | undefined>(undefined);
  const tapDance = (where: 'launcher' | 'header' | 'hero') => (e: { pointerType: string }) => {
    if (e.pointerType === 'mouse') return;
    window.clearTimeout(danceTimer.current);
    setDancing(where);
    danceTimer.current = window.setTimeout(() => setDancing(null), 1400);
  };
  const [picker, setPicker] = useState<{ start: number; query: string } | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const sending = useRef(false); // blocks a second send before `pending` state has updated
  const chatId = useRef<string | null>(null); // saved chat the conversation belongs to
  const chatReady = useRef<Promise<string> | null>(null); // resolves to the current chat's id once it exists

  const focusInput = () => window.setTimeout(() => textarea.current?.focus(), 0);

  // "/" opens the assistant and focuses it from anywhere; Esc backs out of history or menus.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === '/' && !el.closest('input, textarea, select, [contenteditable="true"]')) {
        e.preventDefault();
        onOpenChange(true);
        setView('chat');
        focusInput();
      }
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setView('chat');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpenChange]);

  // Asked to start with some text (e.g. "Ask assistant about it" in the sidebar): fill it in, cursor at the end.
  useEffect(() => {
    if (!prefill) return;
    setView('chat');
    setText(prefill.text);
    window.setTimeout(() => {
      const el = textarea.current;
      el?.focus();
      el?.setSelectionRange(prefill.text.length, prefill.text.length);
    }, 0);
  }, [prefill]);

  useEffect(() => {
    if (view === 'chat') threadEnd.current?.scrollIntoView({ block: 'end' });
  }, [entries, pending, view, open]);

  // Saving is best-effort: a missing table or network blip must never break the conversation itself.
  // A new chat is created once, on its first message; every save waits for *its own* chat, so starting
  // a new chat while an older save is in flight can't mix the two up.
  const persist = (toSave: Entry[], firstMessage?: string) => {
    if (!chatReady.current) {
      const title = firstMessage || 'Image';
      const ready: Promise<string> = createChat(title, workspace).then((id) => {
        if (chatReady.current === ready) {
          // still the open chat (the user hasn't moved on to another one)
          chatId.current = id;
          setActiveChatId(id);
          setChatTitle(title);
        }
        return id;
      });
      chatReady.current = ready;
    }
    chatReady.current
      .then((id) => saveMessages(id, toSave))
      .then(() => setHistoryError(null))
      .catch(() => setHistoryError("Chats aren't being saved yet (run 007_chats.sql in Supabase)."));
  };

  // Change one message (an undo, a draft marked as sent) and save the new version.
  const updateEntry = (id: string, change: (e: Entry) => Entry) => {
    const current = entries.find((e) => e.id === id);
    if (!current) return;
    const changed = change(current);
    setEntries((prev) => prev.map((e) => (e.id === id ? changed : e)));
    persist([changed]);
  };

  const newChat = () => {
    chatId.current = null;
    setActiveChatId(null);
    chatReady.current = null;
    setEntries([]);
    setChatTitle(null);
    setView('chat');
    focusInput();
  };

  const showHistory = async () => {
    setView('history');
    setConfirmDeleteId(null);
    try {
      setChats(await listChats(workspace));
      setHistoryError(null);
    } catch {
      setChats([]);
      setHistoryError('Chat history needs setting up (run 007_chats.sql in Supabase).');
    }
  };

  const openChat = async (chat: ChatSummary) => {
    try {
      setEntries(await loadChat(chat.id));
      chatId.current = chat.id;
      setActiveChatId(chat.id);
      chatReady.current = Promise.resolve(chat.id);
      setChatTitle(chat.title);
      setView('chat');
      focusInput();
    } catch (err) {
      setHistoryError(`Couldn't open that chat: ${(err as Error).message}`);
    }
  };

  const removeChat = async (chat: ChatSummary) => {
    if (confirmDeleteId !== chat.id) return setConfirmDeleteId(chat.id);
    try {
      await deleteChat(chat.id);
      setChats((prev) => prev?.filter((c) => c.id !== chat.id) ?? null);
      if (activeChatId === chat.id) newChat();
    } catch (err) {
      setHistoryError(`Couldn't delete: ${(err as Error).message}`);
    }
  };

  const addFiles = async (files: Iterable<Blob>) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    const prepared = await Promise.all(list.map((f) => prepareImage(f).catch(() => null)));
    setImages((prev) => [...prev, ...prepared.filter((p): p is AiImage => p !== null)].slice(0, 4));
  };

  const takeScreenshot = async () => {
    setMenuOpen(false);
    try {
      const shot = await captureScreenshot();
      if (shot) await addFiles([shot]);
    } catch {
      // user cancelled the screen picker
    }
    textarea.current?.focus();
  };

  // @tags: each task has one (@tomboy, or @sonajhuri/website when its client has several tasks), and a
  // client with several tasks is itself @sonajhuri, standing for all of them.
  const handles = useMemo(() => taskHandles(tasks), [tasks]);
  const clients = useMemo(() => clientTags(tasks), [tasks]);
  const handleList = useMemo(() => [...handles.values(), ...clients.keys()], [handles, clients]);
  const tagsIn = (value: string) => {
    const found = new Set([...value.toLowerCase().matchAll(/@([a-z0-9]+(?:\/[a-z0-9]+)?)/g)].map((m) => m[1]));
    const tagged: { id: string; handle: string }[] = [];
    for (const t of tasks) if (found.has(handles.get(t.id) ?? '')) tagged.push({ id: t.id, handle: handles.get(t.id)! });
    for (const [key, g] of clients)
      if (found.has(key)) for (const t of g.tasks) if (!tagged.some((x) => x.id === t.id)) tagged.push({ id: t.id, handle: key });
    return tagged;
  };

  // Picker entries for the @query: clients first when they match, then tasks, handle-prefix matches first.
  const q = picker?.query.toLowerCase() ?? '';
  type PickerItem = { tag: string; label: string; detail: string };
  const matches: PickerItem[] = picker
    ? [
        ...[...clients.values()]
          .filter((g) => g.key.includes(q) || g.name.toLowerCase().includes(q))
          .map((g) => ({ tag: g.key, label: g.name, detail: `client · ${g.tasks.length} tasks` })),
        ...tasks
          .filter((t) => !t.done && ((handles.get(t.id) ?? '').includes(q) || t.text.toLowerCase().includes(q)))
          .map((t) => ({ tag: handles.get(t.id) ?? '', label: t.text, detail: '' })),
      ]
        .sort((a, b) => Number(b.tag.startsWith(q)) - Number(a.tag.startsWith(q)))
        .slice(0, 7)
    : [];
  const pickerOpen = picker !== null && matches.length > 0;

  const updateText = (value: string, caret: number) => {
    setText(value);
    const found = mentionAt(value, caret);
    setPicker(found);
    if (found?.query !== picker?.query) setPickerIndex(0);
  };

  const pickTag = (item: PickerItem) => {
    const el = textarea.current;
    if (!el || !picker) return;
    const caret = el.selectionStart ?? text.length;
    const insert = `@${item.tag} `;
    const value = text.slice(0, picker.start) + insert + text.slice(caret);
    const pos = picker.start + insert.length;
    setText(value);
    setPicker(null);
    window.setTimeout(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    }, 0);
  };

  const send = async (message: string) => {
    const msg = message.trim();
    if ((!msg && images.length === 0) || pending || sending.current) return;
    sending.current = true;
    setView('chat');
    // Any known @handle in the text is a tag, whether picked from the list or typed by hand.
    const tagged = tagsIn(msg);

    const history: HistoryTurn[] = entries.flatMap((e): HistoryTurn[] => {
      if (e.role === 'user') {
        const count = e.images.length || e.imageCount || 0;
        return [{ role: 'user', text: e.text + (count ? ` [${count} image(s) were attached]` : '') }];
      }
      if (e.role === 'assistant') return [{ role: 'assistant', text: JSON.stringify(e.raw) }];
      return [];
    });
    const sentImages = images;
    const userEntry: Entry = {
      id: crypto.randomUUID(),
      role: 'user',
      text: msg,
      images: sentImages.map((i) => i.previewUrl),
      mentions: tagged.map((m) => m.handle),
    };
    setEntries((prev) => [...prev, userEntry]);
    persist([userEntry], msg);
    setText('');
    setPicker(null);
    setImages([]);
    setPending(true);
    const started = performance.now();
    setElapsed(0);
    const tick = window.setInterval(() => setElapsed(performance.now() - started), 100);

    let reply: Entry;
    try {
      const clientList = [...clients.values()].map((g) => ({ key: g.key, name: g.name, taskIds: g.tasks.map((t) => t.id) }));
      const res = await askAssistant(msg, sentImages, history, tagged, clientList, workspace);
      reply = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: res.reply,
        raw: res.raw,
        results: res.results,
        ms: performance.now() - started,
        meta: res.meta,
        draft: res.draft,
      };
      if (res.results.some((r) => r.kind !== 'skipped')) onChanged();
    } catch (err) {
      reply = { id: crypto.randomUUID(), role: 'error', text: (err as Error).message, details: (err as { details?: string }).details };
    } finally {
      window.clearInterval(tick);
      setPending(false);
      sending.current = false;
    }
    setEntries((prev) => [...prev, reply]);
    persist([reply]);
  };

  const undo = async (entryId: string, index: number) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry || entry.role !== 'assistant') return;
    const result = entry.results[index];
    if (!result.undo || result.undone) return;
    try {
      await undoResult(result.undo);
      updateEntry(entryId, (e) =>
        e.role === 'assistant' ? { ...e, results: e.results.map((r, i) => (i === index ? { ...r, undone: true } : r)) } : e,
      );
      onChanged();
    } catch (err) {
      setEntries((prev) => [...prev, { id: crypto.randomUUID(), role: 'error', text: `Undo failed: ${(err as Error).message}` }]);
    }
  };

  const setDraftState = (entryId: string, draftState: 'copied' | 'sent') =>
    updateEntry(entryId, (e) => (e.role === 'assistant' ? { ...e, draftState } : e));

  const copyDraft = async (entryId: string, draft: AiDraft) => {
    try {
      await navigator.clipboard.writeText(draft.text);
      setDraftState(entryId, 'copied');
    } catch {
      // clipboard blocked; the text is still selectable
    }
  };

  const markDraftSent = async (entryId: string, draft: AiDraft) => {
    try {
      await logDraftSent(draft);
      setDraftState(entryId, 'sent');
      onChanged();
    } catch (err) {
      setEntries((prev) => [...prev, { id: crypto.randomUUID(), role: 'error', text: `Couldn't log it: ${(err as Error).message}` }]);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setPickerIndex((i) => (i + step + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickTag(matches[Math.min(pickerIndex, matches.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // close just the picker
        setPicker(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(text);
    }
    if (e.key === 'Backspace' && !text && images.length) {
      e.preventDefault();
      setImages((prev) => prev.slice(0, -1));
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const canSend = !pending && (text.trim().length > 0 || images.length > 0);
  const headerButton =
    'w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-color)] hover:text-[var(--text-main)] transition-colors cursor-pointer';

  // Closed: just the mascot in the top-right corner, which opens the chat.
  if (!open) {
    return (
      <button
        onClick={() => {
          onOpenChange(true);
          focusInput();
        }}
        onMouseEnter={() => setDancing('launcher')}
        onPointerDown={tapDance('launcher')}
        onMouseLeave={() => setDancing(null)}
        aria-label="Open Bouncy"
        title="Bouncy (press /)"
        className="fixed top-1.5 right-3 z-30 rounded-full shadow-md shadow-[#257EF4]/30 transition-transform hover:scale-105 cursor-pointer"
      >
        <LiveOrb size={36} variant="custom" color="#257EF4" eyeColor="#FAFAFA" dance={dancing === 'launcher'} />
      </button>
    );
  }

  return (
    <aside
      aria-label="Bouncy"
      className="fixed inset-y-0 right-0 z-30 flex w-full sm:w-[380px] flex-col border-l border-[var(--line-color)] bg-[var(--surface)] shadow-xl lg:shadow-none"
    >
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-[var(--line-color)] pl-3 pr-2">
        {view === 'history' ? (
          <button onClick={() => setView('chat')} className={headerButton} aria-label="Back to chat" title="Back to chat">
            <Icon d={BACK} />
          </button>
        ) : (
          <span className="mr-1.5">
            <span onMouseEnter={() => setDancing('header')} onMouseLeave={() => setDancing(null)} onPointerDown={tapDance('header')} className="inline-flex">
              <LiveOrb size={26} variant="custom" color="#257EF4" eyeColor="#FAFAFA" dance={dancing === 'header'} mood={pending ? 'thinking' : null} />
            </span>
          </span>
        )}
        <span className="flex-1 min-w-0 truncate font-display text-sm font-semibold">
          {view === 'history' ? 'History' : (chatTitle ?? 'Bouncy')}
        </span>
        <button onClick={showHistory} className={headerButton} aria-label="Chat history" title="Chat history">
          <Icon d={CLOCK} />
        </button>
        <button onClick={newChat} className={headerButton} aria-label="New chat" title="New chat">
          <Icon d={PEN} />
        </button>
        <button onClick={() => onOpenChange(false)} className={headerButton} aria-label="Close Bouncy" title="Close">
          <Icon d={CLOSE} />
        </button>
      </div>

      {historyError && (
        <p className="shrink-0 border-b border-[var(--line-color)] bg-[var(--bg-color)] px-4 py-2 font-display text-[0.6875rem] text-[var(--text-muted)]">
          {historyError}
        </p>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {view === 'history' ? (
          <div className="px-2 py-3">
            {chats === null ? (
              <p className="px-2 text-sm text-[var(--text-muted)]">Loading…</p>
            ) : chats.length === 0 ? (
              <p className="px-2 text-sm text-[var(--text-muted)]">No saved chats yet.</p>
            ) : (
              groupChats(chats).map((g) => (
                <div key={g.label} className="mb-4">
                  <div className="px-2 pb-1 font-display text-[0.625rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                    {g.label}
                  </div>
                  {g.chats.map((c) => (
                    <div
                      key={c.id}
                      className={`group/chat flex items-center gap-2 rounded-lg px-2 hover:bg-[var(--bg-color)] ${
                        activeChatId === c.id ? 'bg-[var(--bg-color)]' : ''
                      }`}
                    >
                      <button onClick={() => openChat(c)} className="flex-1 min-w-0 py-2 text-left text-sm truncate cursor-pointer">
                        {c.title}
                      </button>
                      <button
                        onClick={() => removeChat(c)}
                        className={`shrink-0 font-display text-[0.6875rem] cursor-pointer transition-opacity ${
                          confirmDeleteId === c.id
                            ? 'text-red-500 opacity-100'
                            : 'text-[var(--text-muted)] opacity-0 group-hover/chat:opacity-100 focus:opacity-100 hover:text-red-500'
                        }`}
                        aria-label="Delete chat"
                      >
                        {confirmDeleteId === c.id ? 'Delete?' : <Icon d={CLOSE} className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        ) : entries.length === 0 ? (
          // Empty chat: mascot + starters
          <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
            <span onMouseEnter={() => setDancing('hero')} onMouseLeave={() => setDancing(null)} onPointerDown={tapDance('hero')} className="inline-flex">
              <LiveOrb size={72} variant="custom" color="#257EF4" eyeColor="#FAFAFA" dance={dancing === 'hero'} />
            </span>
            <div>
              <p className="font-display text-lg font-semibold">Hi, I'm Bouncy.</p>
              <p className="text-sm text-[var(--text-muted)]">What's going on today?</p>
            </div>
            <div className="flex flex-col items-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-[var(--line-color)] bg-[var(--surface)] px-3.5 py-1.5 font-display text-xs hover:border-[var(--text-main)] transition-colors cursor-pointer"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-4 py-4">
            {entries.map((e) =>
              e.role === 'user' ? (
                <div key={e.id} className="flex flex-col items-end gap-1.5">
                  {e.images.length > 0 && (
                    <div className="flex gap-1.5">
                      {e.images.map((src, i) => (
                        <img key={i} src={src} alt="" className="w-16 h-16 rounded-lg object-cover border border-[var(--line-color)]" />
                      ))}
                    </div>
                  )}
                  {!e.images.length && !!e.imageCount && (
                    <span className="font-display text-[0.6875rem] text-[var(--text-muted)]">
                      {e.imageCount} image{e.imageCount === 1 ? '' : 's'} attached
                    </span>
                  )}
                  {e.text && (
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--bg-color)] px-3.5 py-2 text-sm whitespace-pre-wrap">
                      {withMentions(e.text, e.mentions)}
                    </div>
                  )}
                </div>
              ) : e.role === 'assistant' ? (
                <div key={e.id} className="space-y-2">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{e.text}</p>
                  {e.draft && (
                    <div className="rounded-xl border border-[#257EF4]/25 bg-[#257EF4]/[0.04]">
                      <div className="px-3.5 pt-2.5 font-display text-[0.625rem] font-semibold uppercase tracking-widest text-[#257EF4] truncate">
                        Draft for client{e.draft.title && ` · ${e.draft.title}`}
                      </div>
                      <p className="px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap select-text">{e.draft.text}</p>
                      <div className="flex items-center gap-2 px-2.5 pb-2.5">
                        <button
                          onClick={() => copyDraft(e.id, e.draft!)}
                          className="rounded-lg bg-[var(--text-main)] text-[var(--bg-color)] px-3 py-1.5 font-display text-xs font-semibold cursor-pointer hover:opacity-90"
                        >
                          {e.draftState === 'copied' || e.draftState === 'sent' ? 'Copied' : 'Copy'}
                        </button>
                        {e.draft.taskId && (
                          <button
                            onClick={() => markDraftSent(e.id, e.draft!)}
                            disabled={e.draftState === 'sent'}
                            title="Logs it on the task, so it counts as this week's check-in"
                            className="rounded-lg border border-[var(--line-color)] bg-[var(--surface)] px-3 py-1.5 font-display text-xs font-semibold enabled:cursor-pointer enabled:hover:border-[var(--text-main)] disabled:text-[var(--text-muted)]"
                          >
                            {e.draftState === 'sent' ? 'Logged as sent ✓' : 'Mark as sent'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  <p
                    className="font-display text-[0.6875rem] text-[var(--text-muted)] tabular-nums cursor-default"
                    title={
                      e.meta
                        ? [
                            `Sign-in check ${e.meta.ms.auth}ms`,
                            `Load tasks ${e.meta.ms.tasks}ms`,
                            `AI ${e.meta.ms.ai}ms (tried: ${e.meta.tried.join(', ')})`,
                            `Save changes ${e.meta.ms.save}ms`,
                            `Network + start-up ${Math.max(0, Math.round(e.ms - e.meta.ms.total))}ms`,
                          ].join('\n')
                        : undefined
                    }
                  >
                    {(e.ms / 1000).toFixed(1)}s{e.meta && ` · ${e.meta.model}`}
                  </p>
                  {e.results.length > 0 && (
                    <ul className="rounded-xl border border-[var(--line-color)] divide-y divide-[var(--line-color)]">
                      {e.results.map((r, i) => (
                        <li key={i} className={`flex items-center gap-3 px-3 py-2 text-sm ${r.undone ? 'opacity-40' : ''}`}>
                          <span
                            className={`font-display text-[0.625rem] font-semibold uppercase tracking-widest w-16 shrink-0 ${
                              r.kind === 'skipped' ? 'text-[var(--text-muted)]' : ''
                            }`}
                          >
                            {KIND_LABEL[r.kind]}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className={`font-display font-medium ${r.undone ? 'line-through' : ''}`}>{r.title}</span>
                            {r.detail && <span className="text-[var(--text-muted)]"> · {r.detail}</span>}
                          </span>
                          {r.undo && (
                            <button
                              onClick={() => undo(e.id, i)}
                              disabled={r.undone}
                              className="font-display text-xs text-[var(--text-muted)] enabled:hover:text-[var(--text-main)] enabled:cursor-pointer shrink-0"
                            >
                              {r.undone ? 'Undone' : 'Undo'}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div key={e.id} className="text-sm text-[var(--text-muted)] border-l-2 border-[var(--text-muted)] pl-3">
                  <p>{e.text}</p>
                  {e.details && <p className="mt-1 font-display text-[0.6875rem] opacity-80">{e.details}</p>}
                </div>
              ),
            )}
            {pending && (
              <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <Spinner /> Working on it
                <span className="font-display tabular-nums">{(elapsed / 1000).toFixed(1)}s</span>
              </div>
            )}
            <div ref={threadEnd} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="relative shrink-0 px-3 pb-3 pt-2">
        {/* @ task picker */}
        {pickerOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-1 rounded-xl border border-[var(--line-color)] bg-[var(--surface)] shadow-xl py-1" role="listbox">
            <div className="px-3 pt-1.5 pb-1 font-display text-[0.625rem] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              Tag a task
            </div>
            {matches.map((m, i) => (
              <button
                key={m.tag}
                type="button"
                role="option"
                aria-selected={i === pickerIndex}
                onMouseDown={(e) => e.preventDefault()} // keep focus in the textarea
                onMouseEnter={() => setPickerIndex(i)}
                onClick={() => pickTag(m)}
                className={`w-full text-left px-3 py-2 text-sm font-display truncate cursor-pointer ${
                  i === pickerIndex ? 'bg-[var(--bg-color)] text-[#257EF4]' : ''
                }`}
              >
                <span className="font-semibold">@{m.tag}</span>
                <span className="ml-2 text-[var(--text-muted)]">{m.label}</span>
                {m.detail && <span className="ml-1.5 text-[0.6875rem] text-[#257EF4]">{m.detail}</span>}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={onSubmit}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`rounded-2xl border bg-[var(--surface)] transition-colors ${
            dragging ? 'border-[var(--text-main)] border-dashed' : 'border-[var(--line-color)] focus-within:border-[var(--text-main)]'
          }`}
        >
          {images.length > 0 && (
            <div className="flex gap-2 px-3 pt-3">
              {images.map((img, i) => (
                <div key={i} className="relative group/att">
                  <img src={img.previewUrl} alt="" className="w-14 h-14 rounded-lg object-cover border border-[var(--line-color)]" />
                  <button
                    type="button"
                    aria-label="Remove image"
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--text-main)] text-[var(--bg-color)] flex items-center justify-center opacity-0 group-hover/att:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
                  >
                    <Icon d={CLOSE} className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-start gap-2.5 pl-3 pt-2.5">
            {/* Bouncy reads along while you type, and thinks while it works on the answer, with a thought bubble. */}
            <span className="relative inline-flex shrink-0">
              <LiveOrb
                size={30}
                variant="custom"
                color="#257EF4"
                eyeColor="#FAFAFA"
                mood={pending ? 'thinking' : text.trim() ? 'reading' : null}
                readX={Math.min(1, text.length / 48)}
              />
              <span
                aria-hidden="true"
                className={`thought-bubble pointer-events-none absolute -top-6 left-5 z-10 ${pending || text.trim() ? 'is-on' : ''}`}
              >
                <span className="absolute -bottom-1 -left-0.5 h-1.5 w-1.5 rounded-full border border-[var(--line-color)] bg-[var(--surface)]" />
                <span className="flex items-center gap-[3px] rounded-full border border-[var(--line-color)] bg-[var(--surface)] px-2 py-1.5 shadow-md">
                  <span className="thought-dot" />
                  <span className="thought-dot" />
                  <span className="thought-dot" />
                </span>
              </span>
            </span>
            {/* The textarea's own text is transparent; the backdrop behind it draws the same text with tags as pills. */}
            <div className="relative flex-1 min-w-0">
              <div
                ref={backdrop}
                aria-hidden
                className="absolute inset-0 overflow-hidden whitespace-pre-wrap break-words pointer-events-none pr-3 pt-1 pb-1 text-[0.9375rem] leading-relaxed text-[var(--text-main)]"
              >
                {withMentions(text, handleList, true)}
                {'​' /* keeps a trailing newline's height */}
              </div>
              <textarea
                ref={textarea}
                value={text}
                rows={1}
                autoFocus
                onChange={(e) => updateText(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                onClick={(e) => setPicker(mentionAt(text, e.currentTarget.selectionStart ?? text.length))}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={() => setPicker(null)}
                onScroll={(e) => {
                  if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop;
                }}
                placeholder="Ask anything, or tell me what you did…"
                className="relative block w-full resize-none bg-transparent pr-3 pt-1 pb-1 text-[0.9375rem] leading-relaxed outline-none clean-input [field-sizing:content] min-h-9 max-h-40 break-words text-transparent caret-[var(--text-main)] selection:bg-[#257EF4]/20"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex items-center gap-1 relative">
              <button
                type="button"
                aria-label="Add attachment"
                onClick={() => setMenuOpen((o) => !o)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--bg-color)] hover:text-[var(--text-main)] transition-colors cursor-pointer"
              >
                <Icon d={PLUS} />
              </button>
              {menuOpen && (
                <div className="absolute bottom-10 left-0 w-52 rounded-xl border border-[var(--line-color)] bg-[var(--surface)] shadow-xl py-1 text-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      fileInput.current?.click();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[var(--bg-color)] cursor-pointer"
                  >
                    <Icon d={IMAGE} /> Add photos or images
                  </button>
                  <button
                    type="button"
                    onClick={takeScreenshot}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[var(--bg-color)] cursor-pointer"
                  >
                    <Icon d={MONITOR} /> Take screenshot
                  </button>
                </div>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <span className="font-display text-xs text-[var(--text-muted)] px-1">
                <kbd className="border border-[var(--line-color)] rounded px-1">@</kbd> to tag a task
              </span>
            </div>
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send"
              className="w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--text-main)] text-[var(--bg-color)] disabled:bg-[var(--line-color)] disabled:text-[var(--text-muted)] transition-colors cursor-pointer disabled:cursor-default"
            >
              {pending ? <Spinner /> : <Icon d={ENTER} />}
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}
