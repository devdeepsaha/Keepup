// Hourly cron: finds conversations whose next digest is overdue, summarises recent messages
// with Claude Haiku, stores the result in `digests`, and notifies founders + managers via
// task_events. Deployed as a Supabase Edge Function and triggered by pg_cron every hour.
import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const MODEL = 'claude-haiku-5-5';
const MAX_TOKENS = 400;
const DIGEST_PROMPT = `Summarize the following chat in 3–5 bullet points for a manager.
Include: key client requests, decisions made, tasks delegated via @mention, and any blockers.
Be factual, no invented details.

Chat messages (oldest first):
`;

interface DigestRow {
  id: string;
  conversation_id: string;
  next_digest_at: string;
  generated_at: string;
}

interface ConversationRow {
  id: string;
  name: string;
  client_id: string | null;
}

interface MessageRow {
  id: string;
  sender_id: string;
  text: string;
  mentions: { user_id: string; display_name: string }[];
  created_at: string;
  sender?: { display_name: string | null } | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const server = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);
  const claude = new Anthropic({ apiKey: anthropicKey });

  const now = new Date().toISOString();

  // Find all conversations with an overdue digest (using the last digest row's next_digest_at)
  const { data: dueDigests, error: dueErr } = await server
    .from('digests')
    .select('id, conversation_id, next_digest_at, generated_at')
    .lt('next_digest_at', now)
    .order('next_digest_at');

  if (dueErr) return json({ error: dueErr.message }, 500);

  // Deduplicate: only the most-recent digest per conversation matters
  const latestByConv = new Map<string, DigestRow>();
  for (const d of (dueDigests ?? []) as DigestRow[]) {
    const existing = latestByConv.get(d.conversation_id);
    if (!existing || d.generated_at > existing.generated_at) latestByConv.set(d.conversation_id, d);
  }

  const results: { conversation_id: string; status: string; bullets?: string }[] = [];

  for (const digest of latestByConv.values()) {
    const { conversation_id, generated_at } = digest;

    // Load conversation metadata
    const { data: conv } = await server
      .from('conversations')
      .select('id, name, client_id')
      .eq('id', conversation_id)
      .maybeSingle<ConversationRow>();
    if (!conv) continue;

    // Fetch messages since last digest
    const { data: msgs } = await server
      .from('messages')
      .select('id, sender_id, text, mentions, created_at, sender:members!messages_sender_id_fkey(display_name)')
      .eq('conversation_id', conversation_id)
      .gt('created_at', generated_at)
      .is('deleted_at', null)
      .order('created_at');

    const messages = (msgs ?? []) as MessageRow[];

    // Nothing to summarise — just bump next_digest_at
    if (messages.length === 0) {
      const { data: settings } = await server
        .from('digest_settings')
        .select('interval_hours, enabled')
        .or(`conversation_id.eq.${conversation_id},conversation_id.is.null`)
        .order('conversation_id', { nullsFirst: false })
        .limit(1)
        .maybeSingle();
      const hours = settings?.interval_hours ?? 24;
      const nextAt = new Date(Date.now() + hours * 3_600_000).toISOString();
      await server.from('digests').update({ next_digest_at: nextAt }).eq('id', digest.id);
      results.push({ conversation_id, status: 'skipped_no_messages' });
      continue;
    }

    // Build readable transcript
    const transcript = messages
      .map((m) => {
        const senderName = (m.sender as { display_name: string | null } | null)?.display_name ?? 'Unknown';
        const time = new Date(m.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const mentionNote =
          m.mentions?.length ? ` [@mentioned: ${m.mentions.map((mn) => mn.display_name).join(', ')}]` : '';
        return `[${time}] ${senderName}: ${m.text}${mentionNote}`;
      })
      .join('\n');

    // Call Claude Haiku
    let bulletSummary: string;
    try {
      const response = await claude.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: DIGEST_PROMPT + transcript }],
      });
      bulletSummary = response.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('');
    } catch (err) {
      console.error('Claude error for', conversation_id, err);
      results.push({ conversation_id, status: 'claude_error' });
      continue;
    }

    // Determine next_digest_at from settings
    const { data: settings } = await server
      .from('digest_settings')
      .select('interval_hours, enabled')
      .or(`conversation_id.eq.${conversation_id},conversation_id.is.null`)
      .order('conversation_id', { nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const hours = settings?.interval_hours ?? 24;
    const nextAt = new Date(Date.now() + hours * 3_600_000).toISOString();
    const rangeFrom = generated_at;
    const rangeTo = messages.at(-1)!.created_at;

    // Insert new digest row
    const { error: insertErr } = await server.from('digests').insert({
      conversation_id,
      content: bulletSummary,
      message_range: { from: rangeFrom, to: rangeTo, count: messages.length },
      next_digest_at: nextAt,
    });
    if (insertErr) {
      console.error('Insert error', insertErr);
      results.push({ conversation_id, status: 'insert_error' });
      continue;
    }

    // Notify founders + managers via task_events
    const { data: notifyMembers } = await server
      .from('members')
      .select('user_id')
      .overlaps('roles', ['founder', 'manager'])
      .eq('status', 'active');

    if (notifyMembers?.length) {
      const events = notifyMembers.map((m: { user_id: string }) => ({
        user_id: m.user_id,
        event_type: 'digest',
        detail: `Digest ready for "${conv.name}": ${bulletSummary.slice(0, 300)}`,
        metadata: { conversation_id, conversation_name: conv.name },
      }));
      await server.from('task_events').insert(events);
    }

    results.push({ conversation_id, status: 'ok', bullets: bulletSummary });
    console.log(`Digest generated for "${conv.name}" (${messages.length} messages)`);
  }

  return json({ processed: results.length, results });
});
