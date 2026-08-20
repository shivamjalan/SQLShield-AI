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
