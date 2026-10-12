import { useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useOrg } from '../lib/org';
import Logo from './Logo';

// Shown until you have a name (colleagues see it on tasks they give you), and, for someone who joined from an
// invite link, until they've chosen a password so they can sign in again.
export default function WelcomePrompt({ user, currentName }: { user: User; currentName: string | null }) {
  const { setMyName } = useOrg();
  const needsPassword = !!user.invited_at && !user.user_metadata?.password_set;
  const [name, setName] = useState(currentName ?? (user.user_metadata?.display_name as string | undefined) ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (needsPassword) {
      if (password.length < 8) {
        setBusy(false);
        return setError('Use at least 8 characters for your password.');
      }
      const { error } = await supabase.auth.updateUser({ password, data: { password_set: true, display_name: name.trim() } });
      if (error) {
        setBusy(false);
        return setError(error.message);
      }
    }
    const err = await setMyName(name);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <form onSubmit={save} className="w-full max-w-md rounded-2xl border border-[var(--line-color)] bg-[var(--bg-color)] p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <Logo size={28} />
          <span className="font-display text-lg font-bold">Welcome to Keepup</span>
        </div>
        <label className="block font-display text-xs uppercase tracking-widest text-[var(--text-muted)]">
          Your name
          <input
            autoFocus
            required
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="How colleagues will see you"
            className="mt-1 w-full border-b-2 border-[var(--line-color)] bg-transparent py-2 font-display text-xl normal-case tracking-normal text-[var(--text-main)] outline-none focus:border-[var(--accent)] clean-input"
          />
        </label>
        {needsPassword && (
          <label className="mt-5 block font-display text-xs uppercase tracking-widest text-[var(--text-muted)]">
            Choose a password
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="mt-1 w-full border-b-2 border-[var(--line-color)] bg-transparent py-2 font-display text-xl normal-case tracking-normal text-[var(--text-main)] outline-none focus:border-[var(--accent)] clean-input"
            />
          </label>
        )}
        <p className="mt-4 text-sm text-[var(--text-muted)]">
          Your Personal space and Bouncy chats are only ever visible to you. Your Mint-more work can be seen by the people the admin
          chooses.
        </p>
        {error && <p className="mt-3 border-l-2 border-red-500 pl-3 text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="mt-6 w-full rounded-full bg-[var(--text-main)] py-3 font-display text-sm font-semibold uppercase tracking-widest text-[var(--bg-color)] hover:bg-[image:var(--accent-gradient)] disabled:opacity-50 cursor-pointer"
        >
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
