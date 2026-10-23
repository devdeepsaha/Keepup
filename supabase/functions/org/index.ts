// Company admin actions that need Supabase's own user admin: inviting people by email and blocking a leaver's
// sign-in. Who may do what is decided in the database (org_* functions in 015_org_policies.sql), called as the
// signed-in person; only once that allows it does this function use the server key, which never leaves the server.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-keepup-org',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SITE = 'https://keepup.devdeepsaha.in';
// Invite links send people back to the app they were sent from, if it's one of ours.
const ALLOWED_ORIGINS = [SITE, 'http://localhost:5174'];
const ROLES = ['admin', 'founder', 'manager', 'member'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Body =
  | { action: 'invite'; email: string; name: string; roles: string[] }
  | { action: 'invite_client'; email: string; name: string; clientId: string }
  | { action: 'remove'; userId: string }
  | { action: 'restore'; userId: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Not signed in' }, 401);
  const url = Deno.env.get('SUPABASE_URL')!;
  // As the person asking: the database decides what they're allowed to do.
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: who } = await asUser.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  if (!who?.user) return json({ error: 'Not signed in' }, 401);
  const server = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data: me } = await server.from('members').select('roles, status').eq('user_id', who.user.id).maybeSingle();
  const myRoles: string[] = me?.status === 'active' ? (me.roles ?? []) : [];
  const isAdmin = myRoles.includes('admin');
  const isFounder = myRoles.includes('founder');

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  if (body.action === 'invite') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const name = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    let roles = [...new Set((body.roles ?? []).filter((r) => ROLES.includes(r)))];
    if (!roles.length) roles = ['member'];
    if (!EMAIL.test(email)) return json({ error: 'That email doesn’t look right.' }, 400);
    if (!name) return json({ error: 'Add their name.' }, 400);
    if (!isAdmin && !isFounder) return json({ error: 'Only the admin and founders can invite people.' }, 403);
    if (!isAdmin && roles.some((r) => r === 'admin' || r === 'founder')) {
      return json({ error: 'Only the admin can invite founders or admins.' }, 403);
    }

    const { error: invErr } = await server
      .from('invites')
      .upsert({ email, display_name: name, roles, invited_by: who.user.id, created_at: new Date().toISOString(), accepted_at: null });
    if (invErr) return json({ error: invErr.message }, 500);

    const origin = req.headers.get('Origin') ?? '';
    const redirectTo = ALLOWED_ORIGINS.includes(origin) ? origin : SITE;
    const { data, error } = await server.auth.admin.inviteUserByEmail(email, { redirectTo, data: { display_name: name } });
    if (error) {
      const msg = /already been registered|already exists/i.test(error.message)
        ? 'They already have a Keepup account. Find them in the list and set their roles there.'
        : /rate limit/i.test(error.message)
          ? 'Email limit reached for now (Supabase sends a few per hour). Try again a bit later.'
          : error.message;
      return json({ error: msg }, 400);
    }
    // The new account's member row was made by the sign-up trigger; make sure name and roles match the invite.
    if (data.user) {
      await server.from('members').update({ display_name: name, roles, invited_by: who.user.id }).eq('user_id', data.user.id);
    }
    return json({ ok: true, userId: data.user?.id ?? null });
  }

  if (body.action === 'invite_client') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const name = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const clientId = String(body.clientId ?? '');
    if (!EMAIL.test(email)) return json({ error: 'That email doesn\'t look right.' }, 400);
    if (!name) return json({ error: 'Add their name.' }, 400);
    if (!clientId) return json({ error: 'Select a client.' }, 400);
    if (!isAdmin && !isFounder) return json({ error: 'Only the admin and founders can invite clients.' }, 403);

    // Verify the client exists
    const { data: clientRow } = await server.from('clients').select('id').eq('id', clientId).maybeSingle();
    if (!clientRow) return json({ error: 'Client not found.' }, 404);

    const origin = req.headers.get('Origin') ?? '';
    const redirectTo = ALLOWED_ORIGINS.includes(origin) ? origin : SITE;
    const { data, error } = await server.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { display_name: name, client_id: clientId },
    });
    if (error) {
      const msg = /already been registered|already exists/i.test(error.message)
        ? 'They already have a Keepup account.'
        : /rate limit/i.test(error.message)
          ? 'Email limit reached. Try again in a bit.'
          : error.message;
      return json({ error: msg }, 400);
    }
    if (data.user) {
      // Set member row with client role
      await server.from('members').upsert({
        user_id: data.user.id,
        display_name: name,
        roles: ['client'],
        status: 'invited',
        invited_by: who.user.id,
        created_at: new Date().toISOString(),
      });
      // Link to client immediately (org_hello will confirm on first login too)
      await server.from('client_members').upsert({
        client_id: clientId,
        user_id: data.user.id,
        added_by: who.user.id,
        added_at: new Date().toISOString(),
      });
    }
    return json({ ok: true, userId: data.user?.id ?? null });
  }

  if (body.action === 'remove' || body.action === 'restore') {
    const userId = String(body.userId ?? '');
    // The rule (admin only, not yourself) lives in the database function.
    const { error } = await asUser.rpc(body.action === 'remove' ? 'org_remove' : 'org_restore', { target: userId });
    if (error) return json({ error: error.message }, 403);
    // Removed: blocked from signing in (their tasks stay for handover). Restored: allowed again.
    const { error: banErr } = await server.auth.admin.updateUserById(userId, {
      ban_duration: body.action === 'remove' ? '876000h' : 'none',
    });
    if (banErr) return json({ error: banErr.message }, 500);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});
