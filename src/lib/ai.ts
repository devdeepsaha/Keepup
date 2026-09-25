import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Mirrors the agenda-ai edge function's response.
export type Undo =
  | { type: 'delete_task'; taskId: string }
  | { type: 'delete_update'; taskId: string; updateId: string; lastUpdated: string }
  | { type: 'reopen'; taskId: string; updateId: string | null; lastUpdated: string }
  | { type: 'complete'; taskId: string; completedAt: string | null }
  | { type: 'set_due'; taskId: string; dueDate: string | null }
  | { type: 'rename'; taskId: string; text: string }
  | { type: 'set_cadence'; taskId: string; perWeek: number | null }
  | { type: 'set_waiting'; taskId: string; since: string | null; waitingFor: string | null }
  | {
      type: 'replace_planned';
      taskId: string;
      ids: string[];
      restore: { id: string; send_on: string; title: string; text: string; position: number }[];
      deleteTask?: boolean;
    };

export interface AiResult {
  kind: 'added' | 'logged' | 'completed' | 'reopened' | 'due' | 'renamed' | 'rhythm' | 'waiting' | 'planned' | 'skipped';
  title: string;
  detail: string | null;
  undo: Undo | null;
}

export interface AiImage {
  media_type: string;
  data: string; // base64, no data: prefix
  previewUrl: string;
}

export interface AiResponse {
  reply: string;
  results: AiResult[];
  raw: unknown; // the model's JSON, replayed as its turn in later history
  meta?: AiTiming;
  draft?: AiDraft | null;
}

// A client message the assistant wrote, tied to its task when known.
export interface AiDraft {
  taskId: string | null;
  title: string | null;
  text: string;
}

// Log that the drafted message went out: counts as the task's check-in.
// If a planned update is due for that client, this send is it: it's marked sent (one log, not two).
export async function logDraftSent(draft: AiDraft, planned?: { id: string; taskId: string; title: string } | null) {
  if (!draft.taskId) return;
  const summary = draft.text.replace(/\s+/g, ' ').trim();
  const short = summary.length > 150 ? `${summary.slice(0, 147)}…` : summary;
  if (planned) {
    check(await supabase.from('planned_updates').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', planned.id));
    check(await supabase.from('task_updates').insert({ task_id: planned.taskId, text: `Sent client update (${planned.title}): ${short}` }));
    return;
  }
  check(await supabase.from('task_updates').insert({ task_id: draft.taskId, text: `Sent client update: ${short}` }));
}

// Server-side timing breakdown (ms) and which model answered.
export interface AiTiming {
  model: string;
  tried: string[];
  ms: { auth: number; tasks: number; ai: number; save: number; total: number };
}

// An error from the assistant, with optional diagnostics (e.g. what each model did).
export class AssistantError extends Error {
  details?: string;
  constructor(message: string, details?: string) {
    super(message);
    this.details = details;
  }
}

export interface HistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export async function askAssistant(
  message: string,
  images: AiImage[],
  history: HistoryTurn[],
  mentions: { id: string; handle: string }[] = [], // tasks tagged with @handle
  clients: { key: string; name: string; taskIds: string[] }[] = [], // clients with several tasks
  workspace: 'agency' | 'personal' = 'agency',
): Promise<AiResponse> {
  const { data, error } = await supabase.functions.invoke<AiResponse>('agenda-ai', {
    body: {
      message,
      images: images.map(({ media_type, data }) => ({ media_type, data })),
      history,
      mentions,
      clients,
      workspace,
      tz: { name: Intl.DateTimeFormat().resolvedOptions().timeZone, offsetMinutes: new Date().getTimezoneOffset() },
    },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      if (error.context.status === 404) throw new Error("The assistant isn't deployed yet (agenda-ai function not found).");
      const body = await error.context.json().catch(() => null);
      throw new AssistantError(body?.error ?? 'The assistant ran into a problem.', body?.details);
    }
    throw new Error("Couldn't reach the assistant. Check your connection, and that the agenda-ai function is deployed.");
  }
  return data!;
}

// Reverses one change the assistant made.
export async function undoResult(undo: Undo) {
  const tasks = supabase.from('tasks');
  switch (undo.type) {
    case 'delete_task':
      return check(await tasks.delete().eq('id', undo.taskId));
    case 'delete_update':
      check(await supabase.from('task_updates').delete().eq('id', undo.updateId));
      return check(await supabase.from('tasks').update({ last_updated: undo.lastUpdated }).eq('id', undo.taskId));
    case 'reopen':
      if (undo.updateId) check(await supabase.from('task_updates').delete().eq('id', undo.updateId));
      return check(
        await tasks.update({ done: false, completed_at: null, last_updated: undo.lastUpdated }).eq('id', undo.taskId),
      );
    case 'complete':
      return check(await tasks.update({ done: true, completed_at: undo.completedAt }).eq('id', undo.taskId));
    case 'set_due':
      return check(await tasks.update({ due_date: undo.dueDate }).eq('id', undo.taskId));
    case 'rename':
      return check(await tasks.update({ text: undo.text }).eq('id', undo.taskId));
    case 'set_cadence':
      return check(await tasks.update({ cadence_per_week: undo.perWeek }).eq('id', undo.taskId));
    case 'set_waiting':
      return check(await tasks.update({ waiting_since: undo.since, waiting_for: undo.waitingFor }).eq('id', undo.taskId));
    case 'replace_planned':
      // Back to the plan that was there before (or no task at all, if the plan created it).
      if (undo.deleteTask) return check(await tasks.delete().eq('id', undo.taskId));
      if (undo.ids.length) check(await supabase.from('planned_updates').delete().in('id', undo.ids));
      if (undo.restore.length)
        check(await supabase.from('planned_updates').insert(undo.restore.map((r) => ({ ...r, task_id: undo.taskId }))));
      return;
  }
}

function check({ error }: { error: { message: string } | null }) {
  if (error) throw new Error(error.message);
}

// Downscale to Claude's sweet spot (≤1568px on the long edge) and re-encode as JPEG to keep requests small.
export async function prepareImage(file: Blob): Promise<AiImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; // flatten transparency
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { media_type: 'image/jpeg', data: dataUrl.split(',')[1], previewUrl: dataUrl };
}

// Grab one frame of a screen/window/tab the user picks.
export async function captureScreenshot(): Promise<Blob | null> {
  if (!navigator.mediaDevices?.getDisplayMedia) return null;
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  try {
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => setTimeout(r, 150)); // let a real frame arrive
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (!canvas.width || !canvas.height) return null;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
}
