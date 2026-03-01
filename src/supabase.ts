/**
 * Supabase Client — Initialize and export the Supabase client.
 * Uses VITE_ env vars so Vite can inline them at build time.
 * Supabase is REQUIRED — the app does not function without it.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
        '[Supabase] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set. ' +
        'Create a .env file with these variables or set them in your deployment env.'
    );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
