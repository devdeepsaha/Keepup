import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import Logo from './Logo';

type Mode = 'signin' | 'signup';

export default function Auth() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) setError(error.message);
      else if (!data.session) setNotice('Check your inbox to confirm your email, then sign in.');
    }
    setBusy(false);
  };

  const inputClass =
    'w-full bg-transparent border-none py-3 text-2xl md:text-3xl font-display font-medium tracking-tight outline-none clean-input focus:text-[var(--accent)] transition-colors';

  return (
    <div className="min-h-screen p-6 md:p-12 lg:p-24 max-w-5xl mx-auto flex flex-col">
      <header className="mb-16 md:mb-24">
        <div className="mb-8 flex items-center gap-3">
          <Logo size={36} />
          <span className="font-display text-xl font-bold tracking-tight">Keepup</span>
        </div>
        <h1 className="font-display text-6xl md:text-8xl font-bold tracking-tighter leading-none inline-block">
          {mode === 'signin' ? (
            <>
              Welcome
              <br />
              back.
            </>
          ) : (
            <>
              Start
              <br />
              keeping up.
            </>
          )}
        </h1>
      </header>

      <form onSubmit={handleSubmit} className="max-w-xl space-y-8">
        <label className="block relative group">
          <span className="block text-xs uppercase tracking-widest font-display text-[var(--text-muted)]">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
          />
          <div className="absolute left-0 bottom-0 w-full h-[2px] bg-[var(--line-color)] transition-all duration-500 group-focus-within:bg-accent-gradient" />
        </label>

        <label className="block relative group">
          <span className="block text-xs uppercase tracking-widest font-display text-[var(--text-muted)]">Password</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={inputClass}
          />
          <div className="absolute left-0 bottom-0 w-full h-[2px] bg-[var(--line-color)] transition-all duration-500 group-focus-within:bg-accent-gradient" />
        </label>

        {error && <p className="text-red-500 text-sm border-l-2 border-red-500 pl-4">{error}</p>}
        {notice && <p className="text-[var(--text-main)] text-sm border-l-2 border-emerald-400 pl-4">{notice}</p>}

        <div className="flex items-center justify-between gap-6 pt-4">
          <button
            type="submit"
            disabled={busy}
            className="font-display font-semibold uppercase tracking-widest text-sm bg-[var(--text-main)] text-[var(--bg-color)] px-8 py-4 rounded-full hover:bg-[image:var(--accent-gradient)] transition-colors disabled:opacity-50 cursor-pointer"
          >
            {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError(null);
              setNotice(null);
            }}
            className="text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors cursor-pointer"
          >
            {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
