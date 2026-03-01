/**
 * Auth Module — Sign up, sign in, sign out, and session management.
 * Supabase is always required — no guest fallback.
 */
import { supabase } from './supabase';
import type { User, Session } from '@supabase/supabase-js';

export interface AuthUser {
    id: string;
    email: string;
    displayName: string;
}

function toAuthUser(user: User): AuthUser {
    return {
        id: user.id,
        email: user.email || '',
        displayName: user.user_metadata?.display_name || 'Trainer',
    };
}

export async function signUp(
    email: string,
    password: string,
    displayName: string
): Promise<{ user: AuthUser | null; error: string | null }> {
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { display_name: displayName },
        },
    });

    if (error) return { user: null, error: error.message };
    if (!data.user) return { user: null, error: 'Sign-up failed' };

    return { user: toAuthUser(data.user), error: null };
}

export async function signIn(
    email: string,
    password: string
): Promise<{ user: AuthUser | null; error: string | null }> {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (error) return { user: null, error: error.message };
    if (!data.user) return { user: null, error: 'Sign-in failed' };

    return { user: toAuthUser(data.user), error: null };
}

export async function signOut(): Promise<void> {
    await supabase.auth.signOut();
}

export async function getUser(): Promise<AuthUser | null> {
    const { data: { user } } = await supabase.auth.getUser();
    return user ? toAuthUser(user) : null;
}

export function onAuthChange(callback: (user: AuthUser | null) => void): () => void {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (_event: string, session: Session | null) => {
            callback(session?.user ? toAuthUser(session.user) : null);
        }
    );

    return () => subscription.unsubscribe();
}
