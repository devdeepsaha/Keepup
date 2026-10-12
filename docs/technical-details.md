# Technical details

## How it's built
| Part | What it is |
|---|---|
| **App** | React 19 + TypeScript, built with Vite, styled with Tailwind v4. Hosted on **Vercel**, which deploys automatically from the `main` branch of github.com/devdeepsaha/Keepup. |
| **Database and sign-in** | **Supabase** (project `lawtnrbaqblymatktaqz`): Postgres database, email/password sign-in, invite emails, and live updates (realtime). |
| **Bouncy** | Supabase Edge Function `agenda-ai`. It calls Google Gemini (Flash-Lite first, larger Flash models as fallbacks). The API key is stored as a Supabase secret, never in the app. |
| **Company admin actions** | Supabase Edge Function `org`: sends invite emails and blocks a removed person's sign-in. It uses the Supabase server key, which stays on Supabase's servers. |

## Database tables
| Table | Holds | Who can read it |
|---|---|---|
| `tasks` | Every task: title, space (`workspace`), due date, rhythm, client, on hold, links, archive/trash, and assignment fields (`assigned_by`, `assignment_status`, `assignment_note`, `changed_by`) | Owner; Mint-more (`agency`) rows also the admin and people given access |
| `task_updates` | Logs on tasks | Same as the task. Only the owner can write or delete |
| `planned_updates` | Planned client messages | Same as the task. Owner or a Plan-level viewer can change |
| `chats`, `chat_messages` | Bouncy conversations | Owner only |
| `spaces`, `client_colors` | Custom spaces, client colours | Owner only |
| `members` | Everyone in the company: display name, roles, status (invited / active / removed) | All signed-in people (names and roles only, no emails) |
| `access` | Who can see whom: viewer, person, level (`view` / `plan`) | The viewer, the person, the admin, and founders for their own people |
| `invites` | Pending invites | Server only |
| `task_events` | Notices and change history | The person notified; the admin sees all |

## The privacy rules (row-level security)
The database checks every request against these rules, so the app can't show more than allowed even by mistake.
- **`can_see(person, level)`:** true if it's you, if you're an active admin, or if an `access` row gives you that person at that level (Plan includes View).
- **Tasks:**
  - **read:** your own, or a Mint-more task of someone you can see;
  - **edit:** your own, or a Mint-more task of someone you plan for;
  - **create:** your own, or a Mint-more task for someone you plan for (an assignment);
  - **delete:** your own only.
- **Guard on task changes (`tasks_guard`):**
  - Someone who isn't the owner can't move, archive, trash, or answer an assignment.
  - Nobody can give a task away (only a handover can).
  - Every change by another person is recorded as a notice for the owner.
  - When an owner accepts or declines, the person who assigned the task is told.
- **Planned updates (`planned_guard`):** always belong to the task's owner, even when a planner writes them.
- **Rules for running the company** (database functions; the app calls them as the signed-in person):
  - `org_set_roles`: the admin can set any role. A founder can make people they can see managers or members, but can't touch admins or founders, and can't change their own roles. You can't remove your own admin role.
  - `org_set_access`: the admin can give anyone access to anyone. A founder can only give managers people the founder can see, and no higher than the founder's own level.
  - `org_remove` / `org_restore`: admin only. A removed person loses all access, and their tasks stay.
  - `org_handover`: moves someone's open Mint-more tasks, with their logs and planned updates, to another person. You need Plan access to both people.
  - `org_hello`: run at sign-in. It saves your name and activates an invited account.
  - `org_emails`: emails and last sign-in, admin only.
- **New accounts:** a sign-up trigger (`handle_new_user`) adds every new account as a member. If they were invited, the invite's name and roles are used.

## Rollout safety switch
- Until the new app is live, shared rows only reach requests carrying the header `x-keepup-org: 1`, which only the new app sends. The current live site therefore behaves exactly as before. Bouncy's team view is switched on the same way.
- After the push, migration `016_org_live.sql` removes the switch.

## Files
| Where | What |
|---|---|
| `supabase/migrations/014_org.sql` | Company tables, `is_admin`, `can_see`, admin bootstrap |
| `supabase/migrations/015_org_policies.sql` | Sharing rules, guards, notices, company functions |
| `supabase/migrations/016_org_live.sql` | Removes the rollout switch (apply after the push) |
| `supabase/tests/org_privacy_test.sql` | Automated privacy test (47 checks; everything rolled back) |
| `supabase/functions/org/` | Invite / remove server function |
| `supabase/functions/agenda-ai/` | Bouncy, including team mode (`loadTeam`) |
| `src/lib/org.tsx` | Who you are, your roles, the people you can see |
| `src/components/TeamView.tsx`, `PersonView.tsx`, `AdminView.tsx` | Team board, a person's list, admin panel |
| `src/components/AssignmentCard.tsx`, `NoticesBell.tsx`, `WelcomePrompt.tsx` | Accept/decline, notices, first sign-in |
| `src/components/AccessEditor.tsx` | The None / View / Plan picker |
| `docs/` | This guide and the employee guide |

## Everyday commands
| Task | Command |
|---|---|
| Run locally (http://localhost:5174) | `npm run dev -- --port 5174` |
| Build | `npm run build` |
| Apply a migration | `npx supabase db query --linked -f supabase/migrations/<file>.sql` |
| Run the privacy test | `npx supabase db query --linked -f supabase/tests/org_privacy_test.sql` |
| Deploy Bouncy | `npx supabase functions deploy agenda-ai --project-ref lawtnrbaqblymatktaqz --use-api` |
| Deploy the org function | `npx supabase functions deploy org --project-ref lawtnrbaqblymatktaqz --use-api` |

## Limits to know
- **Invite emails:** Supabase's built-in email sends only a few per hour. With about 20 people, invite in small batches.
- **Team pages refresh** every minute and whenever you come back to the tab. Your own list updates instantly.
- **Sign-in links** go to keepup.devdeepsaha.in (and localhost:5174 while testing). Both are set in `supabase/config.toml`.
