import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Supabase access for Vehitra. Public catalog reads need no session; user-table sync (rides,
// vehicles, deadlines) authenticates later through the same client. Config comes from the
// EXPO_PUBLIC_* variables — the anon key is public by design; never put a service key here.

let client: SupabaseClient | null = null;

export function supabaseConfig(): { url: string; anonKey: string } | null {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function hasSupabaseConfig(): boolean {
  return supabaseConfig() != null;
}

// Lazily created shared client. Callers that only need to know whether cloud features are
// available should use hasSupabaseConfig() instead of triggering client creation.
export function getSupabase(): SupabaseClient {
  if (client) return client;
  const cfg = supabaseConfig();
  if (!cfg) {
    throw new Error(
      'Cloud catalog is not configured (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are missing).',
    );
  }
  client = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
