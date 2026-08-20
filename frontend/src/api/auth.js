import { API_BASE_URL, authHeaders, parseJsonOrThrow } from "./client";

export async function login(email, password) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return parseJsonOrThrow(response);
}

export async function fetchMe(accessToken) {
  const response = await fetch(`${API_BASE_URL}/api/me`, {
    headers: authHeaders(accessToken),
  });
  return parseJsonOrThrow(response);
}
