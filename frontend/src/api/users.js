import { API_BASE_URL, authHeaders, parseJsonOrThrow, authFetch } from "./client";

export async function fetchUsers(accessToken) {
  const response = await authFetch(`${API_BASE_URL}/api/users`, {
    headers: authHeaders(accessToken),
  });
  return parseJsonOrThrow(response);
}

export async function updateUserRole(accessToken, userId, role) {
  const response = await authFetch(`${API_BASE_URL}/api/users/${userId}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders(accessToken) },
    body: JSON.stringify({ role }),
  });
  return parseJsonOrThrow(response);
}
