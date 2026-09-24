# Keepup

Keep up with your clients: a minimal task tracker with a weekly check-in rhythm, calendar, insights and an AI assistant (Bouncy). React + Vite + Tailwind, backed by Supabase (auth, Postgres, realtime, Edge Functions).

## Setup

1. Create a Supabase project.
2. In the Supabase **SQL editor**, run [`supabase/schema.sql`](supabase/schema.sql).
3. Copy `.env.example` to `.env.local` and fill in your project URL and anon key (Project Settings → API).
4. In Supabase → Authentication → URL Configuration, add `http://localhost:5173` as the Site URL / redirect URL.
5. Run:

   ```bash
   npm install
   npm run dev
   ```

## Features

- Email/password accounts; each user only sees their own data (row-level security)
- Add, complete, rename (double-click a title) and delete tasks
- Log timestamped updates per task; a trigger bumps the task's `last_updated`
- Stale timer: green → orange (4d) → red (7d+) since the last update
- Optimistic UI with realtime sync across tabs and devices

## AI assistant (bottom bar)

Ask questions ("what's left?") or tell it what happened ("sent the deck to Priya yesterday"), optionally with screenshots.
It answers from your tasks and applies changes (log updates, complete/add tasks, due dates) with an undo for each.

It runs as a Supabase Edge Function (`supabase/functions/agenda-ai`), so your API key never reaches the browser.
It uses **Gemini** (`gemini-3.5-flash-lite` for speed, falling back to `gemini-3.6-flash` and others when busy or slow; free tier) when the `GEMINI_API_KEY` secret is set, otherwise **Claude** (`ANTHROPIC_API_KEY`).
Optional: set `GEMINI_MODEL` to use a different Gemini model. Note that on Gemini's free tier, Google may use your prompts to improve its products.

1. Run `supabase/migrations/004_backdated_logs.sql` in the SQL editor.
2. Deploy the function and set the key (Supabase CLI via npx):

   ```bash
   npx supabase login
   npx supabase functions deploy agenda-ai --project-ref <your-project-ref>
   npx supabase secrets set GEMINI_API_KEY=<your-key> --project-ref <your-project-ref>
   ```

The prompt lives in `supabase/functions/agenda-ai/prompt.ts`.
