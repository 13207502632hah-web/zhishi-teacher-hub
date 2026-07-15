"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Session = {
  authenticated: boolean;
  user?: { name: string; email: string };
  role?: string;
  roleName?: string;
};

type SessionState = { session: Session; sessionError: boolean };

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children, initialSession }: { children: ReactNode; initialSession: Session }) {
  const [session, setSession] = useState<Session>(initialSession);
  const [sessionError, setSessionError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/session", { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : { authenticated: false })
      .then((value) => setSession(value))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSession((current) => current.authenticated ? current : { authenticated: false });
        setSessionError(true);
      });
    return () => controller.abort();
  }, []);

  return <SessionContext.Provider value={{ session, sessionError }}>{children}</SessionContext.Provider>;
}

export function useSessionState() {
  const state = useContext(SessionContext);
  if (!state) throw new Error("useSessionState must be used within SessionProvider");
  return state;
}
