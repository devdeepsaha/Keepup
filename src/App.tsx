import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import Shell from './components/Shell';
import Auth from './components/Auth';

function MissingConfig() {
  return (
    <div className="min-h-screen p-6 md:p-12 lg:p-24 max-w-5xl mx-auto">
      <span className="font-display font-bold tracking-widest uppercase text-xs text-accent-gradient">Setup</span>
      <h1 className="font-display text-5xl md:text-7xl font-bold tracking-tighter leading-none mt-8 mb-10">
        Connect
        <br />
        Supabase.
      </h1>
      <p className="text-lg max-w-xl leading-relaxed">
        Copy <code className="font-display text-[var(--accent)]">.env.example</code> to{' '}
        <code className="font-display text-[var(--accent)]">.env.local</code>, fill in{' '}
        <code className="font-display">VITE_SUPABASE_URL</code> and <code className="font-display">VITE_SUPABASE_ANON_KEY</code>, then
        restart the dev server.
      </p>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!isSupabaseConfigured) return <MissingConfig />;
  if (!ready) return null;
  return session ? <Shell key={session.user.id} user={session.user} /> : <Auth />;
}
