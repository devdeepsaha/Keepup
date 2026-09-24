-- Saved assistant conversations, so past chats can be reopened and continued.
create table if not exists public.chats (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null default 'New chat' check (char_length(title) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.chats (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant', 'error')),
  data       jsonb not null, -- the message as the app shows it (text, changes made, draft, timing)
  created_at timestamptz not null default now()
);

create index if not exists chats_user_updated_idx on public.chats (user_id, updated_at desc);
create index if not exists chat_messages_chat_idx on public.chat_messages (chat_id, created_at);

alter table public.chats enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "chats: owner all" on public.chats;
create policy "chats: owner all" on public.chats
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "chat messages: owner all" on public.chat_messages;
create policy "chat messages: owner all" on public.chat_messages
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.chats c where c.id = chat_id and c.user_id = (select auth.uid()))
  );
