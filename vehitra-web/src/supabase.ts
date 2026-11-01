import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const key = (
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
)?.trim();

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.toLowerCase();
  return (
    normalized.includes('your_project') ||
    normalized.includes('your-supabase') ||
    normalized.includes('your_supabase') ||
    normalized.includes('placeholder') ||
    normalized.includes('replace-me') ||
    normalized.includes('replace_me')
  );
}

export const supabaseProjectHost = (() => {
  if (!url || isPlaceholder(url)) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
})();

export const configuredKeyName = key
  ? (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ? 'VITE_SUPABASE_PUBLISHABLE_KEY' : 'VITE_SUPABASE_ANON_KEY')
  : null;

export const isSupabaseConfigured = Boolean(supabaseProjectHost && key && !isPlaceholder(key));

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
  }
  return supabase;
}
