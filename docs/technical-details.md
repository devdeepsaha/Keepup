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
| `access` | Person exceptions: viewer, person, level (`none` / `view` / `plan`) | The viewer, the person, the admin, founders |
| `viewer_scope` | "Everyone" for a viewer, at view or plan | The viewer, the admin, founders |
| `teams`, `team_members` | Teams and who is in them | All signed-in people |
| `team_access` | A viewer's level on a whole team | The viewer, the admin, founders |
| `invites` | Pending invites | Server only |
| `task_events` | Notices and change history | The person notified; the admin sees all |

## The privacy rules (row-level security)
The database checks every request against these rules, so the app can't show more than allowed even by mistake.
- **`can_see(person, level)`:** uses `access_level(viewer, person)` (0 none, 1 view, 2 plan). It is 2 for yourself and for an active admin. Otherwise the most specific rule wins: a person exception (`access`), then the best team (`team_access`), then Everyone (`viewer_scope`, which never includes an admin).
- **Rules can't over-share:** every rule is capped by what its setter can see (`grant_cap`). A founder's "Everyone at Plan" for a manager only reaches people the founder can see, at the founder's own level. Rules set by a founder who loses the role or leaves stop working by themselves.
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
  - `org_set_access` (person exception), `org_set_scope` (Everyone) and `org_set_team_access` (team): the admin can set them for anyone. A founder can only set them for managers.
  - `org_save_team`, `org_delete_team`, `org_set_team_member`: admin only.
  - `org_my_people` / `org_people_of`: who you, or a given viewer, end up seeing (for the Team page and the access summary).
  - `org_remove` / `org_restore`: admin only. A removed person loses all access, and their tasks stay.
  - `org_handover`: moves someone's open Mint-more tasks, with their logs and planned updates, to another person. You need Plan access to both people.
  - `org_hello`: run at sign-in. It saves your name and activates an invited account.
  - `org_emails`: emails and last sign-in, admin only.
- **New accounts:** a sign-up trigger (`handle_new_user`) adds every new account as a member. If they were invited, the invite's name and roles are used.

## Rollout history
- **Before launch:** shared rows only reached requests carrying the header `x-keepup-org: 1`, which only the new app sends, so the old live site kept working unchanged.
- **At launch (Oct 12, 2026):** after Vercel deployed the new app, migration `016_org_live.sql` removed that switch. The sharing rules now apply to every request.
- **Still in place:** Bouncy's team view only loads for requests from the app (which sends `x-keepup-org: 1`).

## Files
| Where | What |
|---|---|
| `supabase/migrations/014_org.sql` | Company tables, `is_admin`, `can_see`, admin bootstrap |
| `supabase/migrations/015_org_policies.sql` | Sharing rules, guards, notices, company functions |
| `supabase/migrations/016_org_live.sql` | Removed the rollout switch (applied at launch) |
| `supabase/migrations/017_access_groups.sql` | Everyone, Teams, exceptions and the resolver |
| `supabase/tests/org_privacy_test.sql` | Automated privacy test (62 checks; everything rolled back) |
| `supabase/functions/org/` | Invite / remove server function |
| `supabase/functions/agenda-ai/` | Bouncy, including team mode (`loadTeam`) |
| `src/lib/org.tsx` | Who you are, your roles, the people you can see |
| `src/components/TeamView.tsx`, `PersonView.tsx`, `AdminView.tsx` | Team board, a person's list, admin panel |
| `src/components/AssignmentCard.tsx`, `NoticesBell.tsx`, `WelcomePrompt.tsx` | Accept/decline, notices, first sign-in |
| `src/components/AccessEditor.tsx`, `TeamsEditor.tsx` | Who sees whom (Everyone, Teams, Exceptions) and the teams themselves |
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
