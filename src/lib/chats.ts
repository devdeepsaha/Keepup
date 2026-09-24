import { supabase } from './supabase';
import type { AiDraft, AiResult, AiTiming } from './ai';
import type { Workspace } from '../types';

// One message in the assistant conversation, as the app shows it.
export type Entry =
  | { id: string; role: 'user'; text: string; images: string[]; imageCount?: number; mentions: string[] }
  | {
      id: string;
      role: 'assistant';
      text: string;
      raw: unknown;
      results: (AiResult & { undone?: boolean })[];
      ms: number;
      meta?: AiTiming;
      draft?: AiDraft | null;
      draftState?: 'copied' | 'sent';
    }
  | { id: string; role: 'error'; text: string; details?: string };

export interface ChatSummary {
  id: string;
  title: string;
  updated_at: string;
}

// What gets stored for a message. Image previews are large data URLs, so only their count is kept.
function toRow(chatId: string, e: Entry) {
  const { id, role, ...data } = e;
  const stored = role === 'user' ? { ...data, images: [], imageCount: (e as { images: string[] }).images.length } : data;
  return { id, chat_id: chatId, role, data: stored };
}

function check<T>({ data, error }: { data: T; error: { message: string } | null }) {
  if (error) throw new Error(error.message);
  return data;
}

export async function listChats(workspace: Workspace): Promise<ChatSummary[]> {
  const rows = check(await supabase.from('chats').select('id, title, updated_at').eq('workspace', workspace).order('updated_at', { ascending: false }).limit(60));
  return (rows ?? []) as ChatSummary[];
}

export async function loadChat(chatId: string): Promise<Entry[]> {
  const rows = check(
    await supabase.from('chat_messages').select('id, role, data').eq('chat_id', chatId).order('created_at', { ascending: true }),
  ) as { id: string; role: Entry['role']; data: Record<string, unknown> }[];
  return (rows ?? []).map((r) => ({ id: r.id, role: r.role, ...r.data }) as Entry);
}

export async function createChat(title: string, workspace: Workspace): Promise<string> {
  const clean = title.replace(/\s+/g, ' ').trim();
  const short = clean.length > 60 ? `${clean.slice(0, 57)}…` : clean || 'New chat';
  const row = check(await supabase.from('chats').insert({ title: short, workspace }).select('id').single());
  if (!row) throw new Error('Chat was not created');
  return row.id as string;
}

// Insert new messages or update ones that changed (e.g. a change was undone, a draft marked as sent).
export async function saveMessages(chatId: string, entries: Entry[]) {
  if (!entries.length) return;
  check(await supabase.from('chat_messages').upsert(entries.map((e) => toRow(chatId, e))));
  check(await supabase.from('chats').update({ updated_at: new Date().toISOString() }).eq('id', chatId));
}

export async function deleteChat(chatId: string) {
  check(await supabase.from('chats').delete().eq('id', chatId));
}
