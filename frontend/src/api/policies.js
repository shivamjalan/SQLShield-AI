import { API_BASE_URL, authHeaders, parseJsonOrThrow, authFetch } from "./client";

export async function fetchPolicies(accessToken) {
  const response = await authFetch(`${API_BASE_URL}/api/policies`, {
    headers: authHeaders(accessToken),
  });
  return parseJsonOrThrow(response);
}

export async function upsertPolicy(accessToken, policy) {
  const response = await authFetch(`${API_BASE_URL}/api/policies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(accessToken) },
    body: JSON.stringify(policy),
  });
  return parseJsonOrThrow(response);
}

export async function deletePolicy(accessToken, id) {
  const response = await authFetch(`${API_BASE_URL}/api/policies/${id}`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
  });
  if (!response.ok && response.status !== 204) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }
}
