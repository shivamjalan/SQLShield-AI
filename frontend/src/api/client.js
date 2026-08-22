import { getSession, setSession } from "./sessionStore";

export const API_BASE_URL = "http://localhost:4000";

export async function parseJsonOrThrow(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }
  return data;
}

export function authHeaders(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

// Shared across every in-flight authFetch call -- concurrent 401s (e.g. a
// page's own fetch and the sidebar's pending-count poll landing at the
// same moment) await the same refresh instead of racing separate
// POST /auth/refresh calls.
let refreshInFlight = null;

async function refreshAccessToken() {
  const session = getSession();
  if (!session?.refreshToken) {
    throw new Error("No refresh token available");
  }

  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });

  if (!response.ok) {
    throw new Error("Refresh token expired or invalid");
  }

  const { accessToken } = await response.json();
  setSession({ ...session, accessToken });
  return accessToken;
}

// Drop-in replacement for fetch() used by every authenticated API call.
// The access token is short-lived (15 minutes) by design -- rather than
// surface "Invalid or expired token" to the user mid-session, a 401
// transparently triggers one silent refresh-and-retry using the stored
// refresh token. If the refresh token has also expired (or was never
// there), the session is cleared -- ProtectedRoute then redirects to
// /login on its own, same as an explicit logout, so this file never needs
// to know about routing.
export async function authFetch(url, options = {}) {
  const response = await fetch(url, options);

  if (response.status !== 401) {
    return response;
  }

  try {
    if (!refreshInFlight) {
      refreshInFlight = refreshAccessToken().finally(() => {
        refreshInFlight = null;
      });
    }
    const newAccessToken = await refreshInFlight;

    return fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${newAccessToken}` },
    });
  } catch {
    setSession(null);
    return response;
  }
}
