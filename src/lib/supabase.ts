import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

// "x-keepup-org" marks requests from this version of the app, which knows to ask for "only mine" explicitly;
// only these requests get to read colleagues' shared Mint-more work (see 015_org_policies.sql).
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing-key', {
  global: { headers: { 'x-keepup-org': '1' } },
});
