import { API_BASE_URL, authHeaders, parseJsonOrThrow, authFetch } from "./client";

export async function submitQuery(accessToken, query) {
  const response = await authFetch(`${API_BASE_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(accessToken) },
    body: JSON.stringify({ query }),
  });
  return parseJsonOrThrow(response);
}
