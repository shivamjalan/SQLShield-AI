import { createContext, useContext, useState } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Held in React state only (not localStorage) — session is lost on refresh
  // by design, per the current instructions.
  const [session, setSession] = useState(null);

  const value = {
    session,
    login: setSession,
    logout: () => setSession(null),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
