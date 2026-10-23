import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Message } from '../types';

export function useMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const load = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    const { data } = await supabase
      .from('messages')
      .select('id, conversation_id, sender_id, text, media, mentions, reply_to, created_at, edited_at, deleted_at')
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    setMessages((data ?? []) as Message[]);
    setLoading(false);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    load();

    // Subscribe to new messages in real time
    const channel = supabase
      .channel(`conv-messages-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          setMessages((prev) => {
            const msg = payload.new as Message;
            // Avoid duplicates from optimistic inserts
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          setMessages((prev) => prev.map((m) => (m.id === payload.new.id ? (payload.new as Message) : m)));
        },
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [conversationId, load]);

  const markRead = useCallback(async () => {
    if (!conversationId) return;
    await supabase.from('message_reads').upsert({ conversation_id: conversationId, last_read_at: new Date().toISOString() });
  }, [conversationId]);

  return { messages, loading, reload: load, markRead };
}
