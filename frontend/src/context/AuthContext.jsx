import { createContext, useContext, useEffect, useState } from "react";
import { getSession, setSession, subscribe } from "../api/sessionStore";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Session state lives in api/sessionStore.js (persisted to localStorage)
  // so a page refresh keeps it, and so api/client.js's silent access-token
  // refresh can update it from outside React. This just mirrors that
  // store into React state via subscribe().
  const [session, setSessionState] = useState(getSession);

  useEffect(() => subscribe(setSessionState), []);

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
