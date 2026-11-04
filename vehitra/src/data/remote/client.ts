import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Supabase access for Vehitra. Public catalog reads need no session; user-table sync (rides,
// vehicles, deadlines) authenticates later through the same client. Config comes from the
// EXPO_PUBLIC_* variables   the anon key is public by design; never put a service key here.

let client: SupabaseClient | null = null;
let publicCatalogClient: SupabaseClient | null = null;

// Session persistence for signed-in accounts. AsyncStorage is required lazily so this module
// still imports cleanly in non-native contexts (tests, Node)   where the session then lives in
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

/** Lazily created shared client. Callers that only need to know whether cloud features are
 * available should use hasSupabaseConfig() instead of triggering client creation.
 */
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

/** Stateless anon-key client for public catalog data and image assets; never carries account sessions. */
export function getPublicSupabase(): SupabaseClient {
  if (publicCatalogClient) return publicCatalogClient;
  const cfg = supabaseConfig();
  if (!cfg) {
    throw new Error(
      'Cloud catalog is not configured (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are missing).',
    );
  }
  publicCatalogClient = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return publicCatalogClient;
}

// ---------------------------------------------------------------------------
// Email verification and password reset helpers  (Supabase Auth)
// ---------------------------------------------------------------------------

/** True when the app is running on a real device or simulator with the configured deep link scheme. */
export function isAppSchemeAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Linking = require('expo-linking') as { default?: unknown; createURL?: unknown };
    const api = Linking.default ?? Linking;
    return typeof (api as { createURL?: unknown }).createURL === 'function';
  } catch {
    return false;
  }
}

export function verificationRedirectUrl(): string {
  // Supabase appends token_hash and type as query params when redirecting back to the app:
  //   vehitra://login-callback?token_hash=<hash>&type=signup
  // This exact URL must be added to the Supabase redirect allowlist.
  return 'vehitra://login-callback';
}

/** Sign up with email and password. Returns the raw Supabase response (with `data.session` null when
 *  email confirmation is required). */
export async function signUp(email: string, password: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: verificationRedirectUrl() },
  });
  return { data, error };
}

/** Resend the email confirmation message for an address that has no session. */
export async function resendVerification(email: string) {
  const supabase = getSupabase();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: verificationRedirectUrl() },
  });
  return { error };
}

/** Verify an email confirmation link using the token_hash from the deep-link callback URL. */
export async function verifyEmailOtp(
  token_hash: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getSupabase();
  const { error } = await supabase.auth.verifyOtp({
    token_hash,
    type: 'signup',
  });
  return { ok: error == null, error: error?.message };
}

/** Sign in with email and password. Returns the raw Supabase response. */
export async function signIn(email: string, password: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

/** Sign out and clear the local session. */
export async function signOut() {
  const supabase = getSupabase();
  const { error } = await supabase.auth.signOut();
  return { error };
}

/** Return the current session, or null when nothing is signed in. */
export async function getSession() {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  return data;
}

/** True when the stored session is present and the user is authenticated. */
export async function isSignedIn(): Promise<boolean> {
  const session = await getSession();
  return session?.session != null;
}

/** Return the current Supabase user object, or null when signed out. */
export async function getCurrentUser() {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}
