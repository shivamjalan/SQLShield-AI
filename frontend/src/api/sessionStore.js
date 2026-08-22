// Plain-JS (no React) store for the current session, backed by
// localStorage. Deliberately outside React so api/client.js's silent
// token-refresh logic can read/update the session without needing a
// setter threaded in from a component -- AuthContext.jsx is a thin React
// wrapper that subscribes to this store, so a refresh triggered from deep
// inside a fetch call still updates every component reading useAuth().
const STORAGE_KEY = "sqlshield_session";

let session = loadStoredSession();
const listeners = new Set();

function loadStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Corrupted/unreadable storage shouldn't crash the app on load -- just
    // start logged out, same as if nothing had been stored.
    return null;
  }
}

export function getSession() {
  return session;
}

export function setSession(next) {
  session = next;
  if (next) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  listeners.forEach((listener) => listener(session));
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
