"use client";

import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { User, Session } from "@supabase/supabase-js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum time (ms) to wait for initial session check before treating user as logged out. */
const AUTH_TIMEOUT_MS = 5_000;

// ─── Context ────────────────────────────────────────────────────────────────

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ─── Provider ───────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Mounted guard — prevents setState after unmount
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // ── Initial session load with try/catch/finally + timeout ────────
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const loadSession = async () => {
      try {
        // Race the session check against a timeout
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise<null>((_, reject) =>
            timeoutId = setTimeout(
              () => reject(new Error("Auth session check timed out")),
              AUTH_TIMEOUT_MS
            )
          ),
        ]);

        if (mountedRef.current && result) {
          const { data: { session: initialSession } } = result as Awaited<ReturnType<typeof supabase.auth.getSession>>;
          setSession(initialSession);
          setUser(initialSession?.user ?? null);
        }
      } catch (err) {
        // Session check failed or timed out — treat user as logged out
        if (process.env.NODE_ENV === "development") {
          console.warn("[AuthProvider] Initial session check failed:", (err as Error).message);
        }
        if (mountedRef.current) {
          setSession(null);
          setUser(null);
        }
      } finally {
        // ALWAYS clear loading — this is the fix for the infinite loading bug
        if (mountedRef.current) {
          setIsLoading(false);
        }
        if (timeoutId) clearTimeout(timeoutId);
      }
    };

    loadSession();

    // ── Listen for auth state changes ───────────────────────────────
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (mountedRef.current) {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setIsLoading(false);
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  // ── Auth Actions ──────────────────────────────────────────────────

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? new Error(error.message) : null };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error ? new Error(error.message) : null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
