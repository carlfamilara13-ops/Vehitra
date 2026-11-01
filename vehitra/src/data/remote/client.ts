import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Supabase access for Vehitra. Public catalog reads need no session; user-table sync (rides,
// vehicles, deadlines) authenticates later through the same client. Config comes from the
// EXPO_PUBLIC_* variables — the anon key is public by design; never put a service key here.

let client: SupabaseClient | null = null;

// Session persistence for signed-in accounts. AsyncStorage is required lazily so this module
// still imports cleanly in non-native contexts (tests, Node) — where the session then lives in
// memory for the process only. Storage here holds the standard Supabase session envelope, never
// a raw password.
const memoryAuthStore = new Map<string, string>();

type AuthStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

function createAuthStorage(): AuthStorage {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = (require('@react-native-async-storage/async-storage') as {
      default: AuthStorage;
    }).default;
    if (native && typeof native.getItem === 'function') {
      return {
        getItem: (key) => native.getItem(key),
        setItem: (key, value) => native.setItem(key, value),
        removeItem: (key) => native.removeItem(key),
      };
    }
  } catch {
    // Fall through to the in-memory store.
  }
  return {
    getItem: async (key) => memoryAuthStore.get(key) ?? null,
    setItem: async (key, value) => {
      memoryAuthStore.set(key, value);
    },
    removeItem: async (key) => {
      memoryAuthStore.delete(key);
    },
  };
}

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
    auth: {
      // The signed-in session survives app restarts (stored through createAuthStorage) and its
      // access token refreshes in the background, so a long-running session keeps syncing.
      persistSession: true,
      autoRefreshToken: true,
      storageKey: 'vehitra.supabase.session',
      storage: createAuthStorage(),
    },
  });
  return client;
}
