import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../lib/org';
import { useMessages } from '../hooks/useMessages';
import type { Conversation, ConversationMember, Mention, Message } from '../types';

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function dateStr(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function MessageBubble({
  msg,
  isMine,
  senderName,
  prevDate,
}: {
  msg: Message;
  isMine: boolean;
  senderName: string;
  prevDate: string | null;
}) {
  const msgDate = dateStr(msg.created_at);
  const showDate = msgDate !== prevDate;

  const highlightMentions = (text: string, mentions: Mention[]) => {
    if (!mentions.length) return text;
    let result = text;
    for (const m of mentions) {
      result = result.replace(
        new RegExp(`@${m.display_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
        `<span class="text-[var(--accent)] font-semibold">@${m.display_name}</span>`,
      );
    }
    return result;
  };

  return (
    <>
      {showDate && (
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-[var(--line-color)]" />
          <span className="font-display text-xs text-[var(--text-muted)]">{msgDate}</span>
          <div className="flex-1 h-px bg-[var(--line-color)]" />
        </div>
      )}
      <div className={`flex gap-2.5 ${isMine ? 'flex-row-reverse' : ''}`}>
        <div
          className={`flex-1 max-w-[78%] ${isMine ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}
        >
          {!isMine && (
            <span className="font-display text-xs text-[var(--text-muted)] px-1">{senderName}</span>
          )}
          <div
            className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
              isMine
                ? 'bg-[var(--text-main)] text-[var(--bg-color)] rounded-tr-sm'
                : 'bg-[var(--surface)] text-[var(--text-main)] rounded-tl-sm'
            }`}
          >
            {msg.mentions.length > 0 ? (
              <span dangerouslySetInnerHTML={{ __html: highlightMentions(msg.text, msg.mentions) }} />
            ) : (
              msg.text
            )}
            {/* Media thumbnails */}
            {msg.media.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {msg.media.map((m, i) => (
                  m.type.startsWith('image/') ? (
                    <a key={i} href={m.url} target="_blank" rel="noopener noreferrer">
                      <img src={m.url} alt={m.name} className="max-h-40 rounded-lg object-cover" />
                    </a>
                  ) : (
                    <a
                      key={i}
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-lg border border-[var(--line-color)] px-2.5 py-1.5 font-display text-xs"
                    >
                      📎 {m.name}
                    </a>
                  )
                ))}
              </div>
            )}
          </div>
          <span className="font-display text-[10px] text-[var(--text-muted)] px-1">{timeStr(msg.created_at)}</span>
        </div>
      </div>
    </>
  );
}

export default function ConversationView({
  conversationId,
  onBack,
}: {
  conversationId: string;
  onBack: () => void;
}) {
  const org = useOrg();
  const { messages, loading, markRead } = useMessages(conversationId);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [members, setMembers] = useState<ConversationMember[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [pendingMentions, setPendingMentions] = useState<Mention[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{ url: string; type: string; name: string; size: number }[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Load conversation metadata
    supabase.from('conversations').select('*').eq('id', conversationId).maybeSingle().then(({ data }) => {
      if (data) setConv(data as Conversation);
    });
    // Load members
    supabase.from('conversation_members').select('*').eq('conversation_id', conversationId).then(({ data }) => {
      if (data) setMembers(data as ConversationMember[]);
    });
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    markRead();
  }, [markRead, messages.length]);

  // @mention autocomplete: members of this conversation who are internal users
  const mentionCandidates = members
    .map((m) => ({ user_id: m.user_id, display_name: org.nameOf(m.user_id) }))
    .filter((m) => m.user_id !== (members.find((mm) => mm.user_id)?.user_id))
    .filter((m) => mentionQuery ? m.display_name.toLowerCase().includes(mentionQuery.toLowerCase()) : true);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    // Detect @mention trigger
    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const match = before.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setShowMentions(true);
    } else {
      setShowMentions(false);
      setMentionQuery('');
    }
  }, []);

  const insertMention = useCallback((m: Mention) => {
    const cursor = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const atIdx = before.lastIndexOf('@');
    const newText = before.slice(0, atIdx) + `@${m.display_name} ` + after;
    setText(newText);
    setPendingMentions((prev) => [...prev.filter((p) => p.user_id !== m.user_id), m]);
    setShowMentions(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [text]);

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    const path = `${conversationId}/${Date.now()}-${file.name}`;
    const { data, error } = await supabase.storage.from('chat-media').upload(path, file);
    if (error || !data) { setUploading(false); return; }
    const { data: signed } = await supabase.storage.from('chat-media').createSignedUrl(path, 60 * 60 * 24 * 7);
    if (signed?.signedUrl) {
      setPendingMedia((prev) => [...prev, { url: signed.signedUrl, type: file.type, name: file.name, size: file.size }]);
    }
    setUploading(false);
  }, [conversationId]);

  const send = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed && pendingMedia.length === 0) return;
    setSending(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) { setSending(false); return; }

    // Filter mentions to only those actually referenced in the text
    const activeMentions = pendingMentions.filter((m) => trimmed.includes(`@${m.display_name}`));

    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: userId,
      text: trimmed || '📎',
      media: pendingMedia,
      mentions: activeMentions,
    });

    setText('');
    setPendingMentions([]);
    setPendingMedia([]);
    setSending(false);
  }, [text, pendingMedia, pendingMentions, conversationId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const clientName = conv?.client_id
    ? org.clients.find((c) => c.id === conv.client_id)?.name ?? null
    : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--line-color)] px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer font-display text-lg">←</button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-display font-semibold text-base truncate">{conv?.name ?? '…'}</h2>
            {conv && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 font-display text-[10px] font-semibold ${
                  conv.type === 'client_facing'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-[var(--surface)] text-[var(--text-muted)]'
                }`}
              >
                {conv.type === 'client_facing' ? 'Client Visible' : 'Internal'}
              </span>
            )}
          </div>
          {clientName && (
            <p className="font-display text-xs text-[var(--text-muted)]">{clientName}</p>
          )}
        </div>
        <div className="flex -space-x-1.5 shrink-0">
          {members.slice(0, 5).map((m) => (
            <div
              key={m.user_id}
              className="w-6 h-6 rounded-full bg-[var(--surface)] border border-[var(--bg-color)] flex items-center justify-center font-display text-[9px] font-bold"
              title={org.nameOf(m.user_id)}
            >
              {org.nameOf(m.user_id).charAt(0).toUpperCase()}
            </div>
          ))}
          {members.length > 5 && (
            <div className="w-6 h-6 rounded-full bg-[var(--surface)] border border-[var(--bg-color)] flex items-center justify-center font-display text-[9px] text-[var(--text-muted)]">
              +{members.length - 5}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
        {loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
        {!loading && messages.length === 0 && (
          <p className="text-sm text-[var(--text-muted)] text-center mt-8">No messages yet. Say hello!</p>
        )}
        <MessagesWithUser messages={messages} org={org} />
        <div ref={bottomRef} />
      </div>

      {/* Pending media preview */}
      {pendingMedia.length > 0 && (
        <div className="shrink-0 px-4 pt-2 flex flex-wrap gap-2">
          {pendingMedia.map((m, i) => (
            <div key={i} className="relative group">
              {m.type.startsWith('image/') ? (
                <img src={m.url} alt={m.name} className="h-16 w-16 rounded-lg object-cover" />
              ) : (
                <div className="h-16 px-3 flex items-center rounded-lg bg-[var(--surface)] font-display text-xs">{m.name}</div>
              )}
              <button
                onClick={() => setPendingMedia((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white font-bold text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer"
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="shrink-0 border-t border-[var(--line-color)] p-3 relative">
        {showMentions && mentionCandidates.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-1 rounded-xl border border-[var(--line-color)] bg-[var(--bg-color)] shadow-lg overflow-hidden z-10 max-h-40 overflow-y-auto">
            {mentionCandidates.map((m) => (
              <button
                key={m.user_id}
                onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                className="w-full px-4 py-2.5 text-left font-display text-sm hover:bg-[var(--surface)] cursor-pointer"
              >
                @{m.display_name}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="shrink-0 rounded-lg border border-[var(--line-color)] p-2 text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--text-main)] cursor-pointer disabled:opacity-40"
            title="Attach file"
          >
            {uploading ? (
              <span className="font-display text-xs">…</span>
            ) : (
              <span className="text-base leading-none">📎</span>
            )}
          </button>
          <input ref={fileInputRef} type="file" className="hidden" multiple onChange={(e) => {
            for (const f of Array.from(e.target.files ?? [])) uploadFile(f);
            e.target.value = '';
          }} />
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Message… (@ to mention)"
            className="flex-1 resize-none rounded-xl border border-[var(--line-color)] bg-[var(--surface)] px-3.5 py-2.5 text-sm outline-none focus:border-[var(--text-main)] clean-input max-h-32"
            style={{ overflow: 'hidden' }}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, 128) + 'px';
            }}
          />
          <button
            onClick={send}
            disabled={sending || (!text.trim() && pendingMedia.length === 0)}
            className="shrink-0 rounded-lg bg-[var(--text-main)] px-4 py-2.5 font-display text-sm font-semibold text-[var(--bg-color)] hover:bg-[image:var(--accent-gradient)] hover:text-white disabled:opacity-40 cursor-pointer"
          >
            {sending ? '…' : '→'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Separate component to access user id and render messages
function MessagesWithUser({ messages, org }: { messages: Message[]; org: ReturnType<typeof useOrg> }) {
  const [myId, setMyId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null));
  }, []);

  if (!myId) return null;

  let prevDate: string | null = null;
  return (
    <>
      {messages.map((msg) => {
        const isMine = msg.sender_id === myId;
        const pd = prevDate;
        prevDate = dateStr(msg.created_at);
        return (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isMine={isMine}
            senderName={org.nameOf(msg.sender_id)}
            prevDate={pd}
          />
        );
      })}
    </>
  );
}
