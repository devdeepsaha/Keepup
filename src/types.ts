export interface TaskUpdate {
  id: string;
  task_id: string;
  text: string;
  created_at: string;
}

export interface Task {
  id: string;
  text: string;
  done: boolean;
  completed_at: string | null;
  due_date: string | null; // 'YYYY-MM-DD'
  cadence_per_week: number | null; // check-ins per week, spaced 2+ days apart
  handle?: string | null; // custom @tag; automatic one when empty
  client?: string | null; // client this task belongs to; taken from the title when empty
  waiting_since?: string | null; // set while blocked on the client (pauses the quiet timer)
  waiting_for?: string | null; // what we're waiting for, e.g. "homepage content"
  workspace?: Workspace;
  archived_at?: string | null; // archived: hidden from the lists, kept in history
  deleted_at?: string | null; // in the trash; purged after 30 days
  last_updated: string;
  created_at: string;
  task_updates: TaskUpdate[];
  planned_updates?: PlannedUpdate[]; // client updates planned for later check-in days
  links?: TaskLink[]; // saved site links (Live, Test…)
  user_id?: string; // whose task it is
  assigned_by?: string | null; // a founder or manager who gave it to its owner
  assignment_status?: 'pending' | 'accepted' | 'declined' | null; // the owner's answer
  assignment_note?: string | null; // why they declined
  // richer task metadata (phase 7)
  scheduled_date?: string | null; // 'YYYY-MM-DD' — when to work on it
  deadline?: string | null; // ISO timestamp — when it's due to the client
  priority?: 'low' | 'medium' | 'high' | 'urgent' | null;
  topic?: string | null; // short subject, e.g. "Homepage copy"
  task_brief?: string | null; // longer description / brief
  client_id?: string | null; // FK to public.clients
  task_references?: TaskReference[]; // optional links (spreadsheet, IG, etc.)
}

export interface TaskReference {
  label: string; // "Design brief", "Instagram post", etc.
  url: string;
}

export interface Client {
  id: string;
  name: string;
  team_id: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'done';
  created_by: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  client_id: string | null;
  project_id: string | null;
  name: string;
  type: 'internal' | 'client_facing';
  created_by: string | null;
  created_at: string;
}

export interface ConversationMember {
  conversation_id: string;
  user_id: string;
  role: 'admin' | 'member';
  joined_at: string;
}

export interface MediaAttachment {
  url: string;
  type: string;  // 'image/jpeg', 'video/mp4', etc.
  name: string;
  size: number;
}

export interface Mention {
  user_id: string;
  display_name: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  media: MediaAttachment[];
  mentions: Mention[];
  reply_to: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export interface DigestSettings {
  id: string;
  conversation_id: string | null;
  interval_hours: 1 | 6 | 12 | 24 | 48;
  enabled: boolean;
  updated_at: string;
}

export interface Digest {
  id: string;
  conversation_id: string;
  content: string;
  message_range: { from: string; to: string; count: number };
  generated_at: string;
  next_digest_at: string;
}

export interface TaskLink {
  label: string; // "Live", "Test", or your own
  url: string;
}

// A client update planned for a later day (finished work shared in parts).
export interface PlannedUpdate {
  id: string;
  task_id: string;
  send_on: string; // 'YYYY-MM-DD'
  title: string;
  text: string; // the message, ready to send
  position: number;
  status: 'planned' | 'sent';
  sent_at: string | null;
}

// A space's key: the built-in 'agency' (Mint-more) and 'personal', or one you created.
export type Workspace = string;

export interface Space {
  key: string;
  name: string;
  kind: 'work' | 'personal'; // work: clients, rhythms, client updates; personal: a plain to-do list
  color: string;
  position: number;
  builtin?: boolean;
}
