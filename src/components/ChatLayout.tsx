import { useState } from 'react';
import ChatInbox from './ChatInbox';
import ConversationView from './ConversationView';
import NewConversationModal from './NewConversationModal';

export default function ChatLayout({ initialConversationId }: { initialConversationId?: string | null }) {
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId ?? null);
  const [showNewConvModal, setShowNewConvModal] = useState(false);

  return (
    <div className="flex h-[calc(100vh-3rem)] overflow-hidden">
      {/* Left panel: conversation list */}
      <div
        className={`flex-shrink-0 border-r border-[var(--line-color)] overflow-y-auto flex flex-col
          ${conversationId ? 'hidden md:flex md:w-72 lg:w-80' : 'flex w-full md:w-72 lg:w-80'}`}
      >
        <ChatInbox
          activeId={conversationId}
          onOpen={(id) => setConversationId(id)}
          onNew={() => setShowNewConvModal(true)}
        />
      </div>

      {/* Right panel: active conversation or empty state */}
      <div className={`flex-1 overflow-hidden flex flex-col ${conversationId ? 'flex' : 'hidden md:flex'}`}>
        {conversationId ? (
          <ConversationView
            conversationId={conversationId}
            onBack={() => setConversationId(null)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-[var(--text-muted)]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" className="w-12 h-12 mb-3 opacity-30">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p className="font-display font-medium text-sm">Select a conversation</p>
            <p className="text-xs mt-1 opacity-70">or start a new one from the left</p>
          </div>
        )}
      </div>

      {showNewConvModal && (
        <NewConversationModal
          onClose={() => setShowNewConvModal(false)}
          onCreate={(id) => { setShowNewConvModal(false); setConversationId(id); }}
        />
      )}
    </div>
  );
}
