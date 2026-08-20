import { API_BASE_URL, authHeaders, parseJsonOrThrow } from "./client";

export async function fetchAuditLogs(accessToken, filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  }
  const query = params.toString();

  const response = await fetch(`${API_BASE_URL}/api/audit-logs${query ? `?${query}` : ""}`, {
    headers: authHeaders(accessToken),
  });
  return parseJsonOrThrow(response);
}

export async function fetchAuditStats(accessToken) {
  const response = await fetch(`${API_BASE_URL}/api/audit-logs/stats`, {
    headers: authHeaders(accessToken),
  });
  return parseJsonOrThrow(response);
}
