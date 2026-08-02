"use client";

import { HttpError, requestJson } from "@/app/lib/http-client";
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
    const refreshSession = async () => {
      try {
        const value = await requestJson<Session>("/api/session", { signal: controller.signal, cache: "no-store" });
        if (!value || typeof value.authenticated !== "boolean") throw new HttpError(200, "会话接口没有返回有效数据");
        setSession(value);
        setSessionError(false);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof HttpError && error.status === 401) {
          setSession({ authenticated: false });
          setSessionError(false);
          return;
        }
        setSession({ authenticated: false });
        setSessionError(true);
      }
    };
    void refreshSession();
    return () => controller.abort();
  }, []);

  return <SessionContext.Provider value={{ session, sessionError }}>{children}</SessionContext.Provider>;
}

export function useSessionState() {
  const state = useContext(SessionContext);
  if (!state) throw new Error("useSessionState must be used within SessionProvider");
  return state;
}
