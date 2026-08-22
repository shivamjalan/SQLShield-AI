import { API_BASE_URL, authHeaders, parseJsonOrThrow, authFetch } from "./client";

// Only email/password are ever sent -- the backend hardcodes role='intern'
// server-side and ignores any role field a client sends, so there's no
// point offering a role choice in this form.
export async function register(email, password) {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return parseJsonOrThrow(response);
}

export async function login(email, password) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return parseJsonOrThrow(response);
}

export async function fetchMe(accessToken) {
  const response = await authFetch(`${API_BASE_URL}/api/me`, {
    headers: authHeaders(accessToken),
  });
  return parseJsonOrThrow(response);
}
