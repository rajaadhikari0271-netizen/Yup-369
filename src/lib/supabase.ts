import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('http'));
}

let cachedClient: SupabaseClient | null = null;

/**
 * Returns a configured Supabase client when VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY are provided. Otherwise returns null and the
 * application uses the Express + persisted JSON store backend (/api/*).
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (!cachedClient) {
    cachedClient = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,
      },
    });
  }
  return cachedClient;
}
