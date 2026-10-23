import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from '../lib/org';
import ClientProjectsView from './ClientProjectsView';
import ChatInbox from './ChatInbox';
import ConversationView from './ConversationView';

type PortalView = 'projects' | 'chat' | 'conversation';

export default function ClientPortalShell() {
  const org = useOrg();
  const [view, setView] = useState<PortalView>('projects');
  const [conversationId, setConversationId] = useState<string | null>(null);

  const nav = [
    { id: 'projects' as const, label: 'Projects' },
    { id: 'chat' as const, label: 'Chat' },
  ];

  const clientName = org.myClientIds.length > 0
    ? org.clients.find((c) => c.id === org.myClientIds[0])?.name ?? 'Client Portal'
    : 'Client Portal';

  return (
    <div className="flex h-svh flex-col bg-[var(--bg-color)] text-[var(--text-main)]">
      {/* Top bar */}
      <header className="shrink-0 flex items-center justify-between border-b border-[var(--line-color)] px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-[image:var(--accent-gradient)]" />
          <span className="font-display text-sm font-bold">{clientName}</span>
        </div>
        <nav className="flex items-center gap-1">
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => setView(n.id)}
              className={`rounded-lg px-3 py-1.5 font-display text-sm transition-colors cursor-pointer ${
                view === n.id || (view === 'conversation' && n.id === 'chat')
                  ? 'bg-[var(--text-main)] text-[var(--bg-color)] font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <button
          onClick={() => supabase.auth.signOut()}
          className="font-display text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
        >
          Sign out
        </button>
      </header>

      {/* Body */}
      <main className="flex-1 overflow-hidden">
        {view === 'projects' && (
          <div className="h-full overflow-y-auto">
            <ClientProjectsView
              onOpenChat={(projectId) => {
                // Find a conversation for this project
                setView('chat');
                // User can then open the conversation from ChatInbox
                // Passing projectId for future deep-link support
                void projectId;
              }}
            />
          </div>
        )}

        {view === 'chat' && (
          <div className="h-full">
            <ChatInbox
              onOpen={(id) => { setConversationId(id); setView('conversation'); }}
              onNew={() => {}} // clients can't create conversations
            />
          </div>
        )}

        {view === 'conversation' && conversationId && (
          <div className="h-full">
            <ConversationView
              conversationId={conversationId}
              onBack={() => setView('chat')}
            />
          </div>
        )}
      </main>
    </div>
  );
}
