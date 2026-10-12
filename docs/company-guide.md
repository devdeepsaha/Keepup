# Keepup for Mint-more: how the company system works

Keepup is still everyone's own task tracker. What's new is that the **Mint-more space** can now be seen by the
right people, so founders and managers know who is working on what, can plan with them, and can hand out work.
Nothing else is shared.

## The four roles

| Role | Who | What they can do |
|---|---|---|
| **Admin** | Devdeep | Sees everyone's Mint-more work. Invites people, sets any role, decides which people each founder sees, removes people who leave, reads the change history. |
| **Founder** | Set by the admin | Sees **only the people the admin gives them**. Can edit and assign their tasks (with "Plan" access), make those people managers, and decide which of them each manager sees. |
| **Manager** | Set by the admin or a founder | Sees **only the people a founder gives them**. With "View" they can read; with "Plan" they can also edit and assign. |
| **Member** | Everyone | Their own tasks, as always. Accepts or declines tasks given to them, with a note. |

One person can hold several roles. Devdeep is **Admin + Founder + Member**. Everyone also keeps their own task
list, whatever their role.

## What is shared and what is private

| | Who can see it |
|---|---|
| Your **Mint-more** tasks, logs and planned client updates | You, the admin, and anyone who was given access to you |
| Your **Personal** space and any space you create | **Only you.** Not the admin, founders or managers |
| Your **Bouncy chats** | Only you |
| Your client colours and space settings | Only you |

Personal spaces show a small "Only you can see this space" line as a reminder.

## Access levels: View and Plan

Access is given **per person**, from one person (the viewer) to another (the person they see).

- **View** shows their Mint-more tasks, logs, due dates, rhythms and planned client updates. Read only.
- **Plan** includes everything in View, plus:
  - editing their tasks: title, due date, rhythm, client, links, on hold;
  - moving or removing their planned updates;
  - **assigning new tasks**.

Some things only the owner of a task can ever do, whatever access others have:
- write or delete **logs** (updates are always their own words);
- **mark a planned update as sent**;
- archive, trash or move a task to another space;
- accept or decline an assignment.

A founder can only pass on what they have themselves. If the admin gave a founder **View** of Rahul, that founder
can give a manager **View** of Rahul, but not **Plan**.

## How each person uses it

### Admin (sidebar → Admin)
1. **Invite someone:** enter their email, name and role, then Send invite. They get an email with a link to
   keepup.devdeepsaha.in. When they open it, Keepup asks them to choose a password (and confirm their name).
   - Supabase's free email allows only a few emails an hour, so space invites out.
   - If you hit the limit, the panel says so; try again later.
2. **People:** tap Admin, Founder or Manager next to a person to turn that role on or off. Member is always on.
   You can't remove your own admin role, so the company is never left without an admin.
3. **Who sees whom:** pick a founder or manager, then choose None, View or Plan for each person.
4. **Remove:** for someone who left. They can no longer sign in and lose any access they had. **Their Mint-more
   tasks stay** so the work can be handed over. Restore undoes it.
5. **Change history:** every change someone made to another person's task, every assignment, and every accept or
   decline, with who did it and when.

### Founder (sidebar → Team)
- One card per person you can see, showing:
  - open tasks;
  - what needs attention (late or missed work);
  - what's on hold;
  - updates logged this week;
  - their last update;
  - their next planned client update;
  - tasks they haven't accepted yet.
- The client chips at the top filter the board to one client, to see who is on Tomboy, for example.
- Click a card to open that person's Mint-more list. With Plan access:
  - type in **"Assign a task to …"** to give them work;
  - open any task to edit it.
- **Make manager / Remove manager role** on a card, for people you can see.
- **Managers** section: pick a manager and give them people from your own list.
- **Hand over** (at the bottom of a person's list, with Plan access to both people) moves all of someone's open
  Mint-more tasks, with their logs and planned updates, to someone else. They accept them like any assignment.
  Use it when someone leaves.

### Manager (sidebar → Team)
Same board and person lists as a founder, limited to the people a founder gave them, and only at the level given.

### Member
- A task someone gives you appears at the top under **New from your team**, showing who it's from and when it's
  due.
  - **Accept** moves it into your normal list.
  - **Decline** asks for a short note ("Fully booked until Friday"). The task moves to your Archive, and the person
    who assigned it is told, note included.
- Tasks given to you show "From Arjun" on their row.
- The **bell** in the top bar lists what others changed on your tasks, for example "Arjun changed the due date of
  'Tomboy homepage' to Fri" or "Priya planned a client update for Tue". Clicking a notice opens the task.

## Bouncy and the team

Bouncy still only **changes your own tasks**. For founders, managers and the admin it also gets a **read-only view
of the team** (exactly the people you can see), so you can ask:
- "What's late on my team?"
- "What is Rahul working on?"
- "Who has a client update due today?"

If you ask it to change a colleague's task, it points you to the Team page. Bouncy never sees anyone's Personal
space or chats.

## Your question: I'm the admin and also an employee. Can a founder control me?

**No, unless you choose to allow it.**
- Founders see only the people **you**, as admin, give them. By default no founder can see your tasks at all.
- If you ever give a founder access to yourself, they see only your **Mint-more** work. With Plan, they could also
  edit your tasks or assign you work, which you'd accept or decline like anyone else.
- They can **never**:
  - see your Personal space or Bouncy chats;
  - change your roles (only an admin can change an admin's or founder's roles);
  - remove you;
  - make themselves admin.
- A founder can't hand out access to you either, unless you gave them access first.

## How the privacy is enforced

The rules live in the **database** (Supabase row-level security), not just in the app's screens. So even someone
calling the database directly gets nothing they aren't allowed to see.
- The rules are in `supabase/migrations/014_org.sql` and `015_org_policies.sql`.
- An automated test (`supabase/tests/org_privacy_test.sql`) creates a fake admin, founder, manager and three
  members, checks what each one can see and do, then rolls everything back. **All 47 checks pass.** Run it any time
  with:
  ```
  npx supabase db query --linked -f supabase/tests/org_privacy_test.sql
  ```
- The admin actions that need Supabase's own user controls (sending invites, blocking a leaver's sign-in) run in the
  `org` server function. Before it acts, it asks the database whether you're allowed. The secret server key never
  leaves Supabase.

## Status: live

The company version has been live on **keepup.devdeepsaha.in** since October 12, 2026.
- The database sharing rules, the `org` server function and Bouncy's team mode are all running.
- The privacy test passed all 47 checks again after launch.

Next steps for the admin:
1. Open **Admin** and set roles: who is a founder, who is a manager.
2. In **Who sees whom**, give each founder their people.
3. Invite everyone, a few at a time (the email limit is a few per hour).
4. Hand out the **Keepup employee guide** so everyone knows how it works.

Right now Keepup has two accounts: Devdeep (Admin, Founder, Member) and Rishav (Member). Rishav will be asked for a
name the next time they sign in.
